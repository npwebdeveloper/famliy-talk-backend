import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';
import { ConversationsService } from '../conversations/conversations.service';
import { S3Service } from '../s3/s3.service';
import { CallsService } from '../calls/calls.service';
import { Call, CallType, CallStatus } from '../calls/entities/call.entity';
import { MessageCallType, MessageCallStatus } from '../messages/entities/message.entity';
import { NotificationsService } from '../notifications/notifications.service';

/** How often the ringing-timeout / zombie-call sweeps run. */
const CALL_SWEEP_INTERVAL_MS = 10_000;

@WebSocketGateway({
    cors: {
        origin: '*', // Configure this properly in production
        credentials: true,
    },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
    @WebSocketServer()
    server: Server;

    private userSockets: Map<string, string> = new Map(); // userId -> socketId
    private callSweepInterval: NodeJS.Timeout;

    // socketId -> who's typing where. Purely in-memory/ephemeral — never
    // persisted, never replayed on reconnect (see handleTyping/handleDisconnect).
    private typingBySocket: Map<string, { userId: string; conversationId: string }> = new Map();

    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
        private messagesService: MessagesService,
        private usersService: UsersService,
        private conversationsService: ConversationsService,
        private s3Service: S3Service,
        private callsService: CallsService,
        private notificationsService: NotificationsService,
    ) { }

    onModuleInit() {
        this.callSweepInterval = setInterval(() => this.runCallMaintenanceSweep(), CALL_SWEEP_INTERVAL_MS);
    }

    onModuleDestroy() {
        clearInterval(this.callSweepInterval);
    }

    async handleConnection(client: Socket) {
        try {
            console.log(`Connection attempt from ${client.id}`);
            console.log('Handshake auth:', client.handshake.auth);
            console.log('Handshake headers:', client.handshake.headers);

            // Extract token from handshake
            const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

            if (!token) {
                console.warn(`Connection rejected for ${client.id}: No token provided`);
                client.disconnect();
                return;
            }

            // Verify JWT token
            const payload = this.jwtService.verify(token, {
                secret: this.configService.get<string>('JWT_SECRET'),
            });

            const userId = payload.sub;

            // Store user-socket mapping
            this.userSockets.set(userId, client.id);
            client.data.userId = userId;

            // Update user online status
            await this.usersService.updateOnlineStatus(userId, true);

            // Notify all users about online status
            this.server.emit('user_online', { userId });

            // Device is now reachable — mark all pending messages as DELIVERED
            // and flip the senders' ticks in real-time (fire-and-forget)
            this.deliverPendingMessages(userId).catch(err =>
                console.error('Pending delivery sweep failed:', err.message),
            );

            // Same idea for calls: if this user has a call still ringing for
            // them (the original invite-time emit went nowhere because they
            // were backgrounded/killed and only just reconnected — e.g. by
            // tapping the FCM notification), replay it now so the incoming
            // call screen actually appears instead of just the notification.
            this.resyncRingingCall(userId, client).catch(err =>
                console.error('Ringing-call resync failed:', err.message),
            );

            console.log(`User ${userId} connected with socket ${client.id}`);
        } catch (error) {
            console.error('Connection error:', error.message);
            if (error.name === 'TokenExpiredError') {
                // Tell the client the token is expired so it knows to refresh (not just retry)
                client.emit('token_expired', { message: 'Access token expired. Please refresh and reconnect.' });
            }
            client.disconnect();
        }
    }

    async handleDisconnect(client: Socket) {
        const userId = client.data.userId;

        // Unexpected drop mid-typing must not leave the other side staring at
        // a "typing..." indicator forever — nothing else will ever tell them to clear it.
        const typingState = this.typingBySocket.get(client.id);
        if (typingState) {
            this.typingBySocket.delete(client.id);
            this.server.to(`conversation:${typingState.conversationId}`).emit('user_stopped_typing', {
                conversationId: typingState.conversationId,
                userId: typingState.userId,
            });
        }

        if (userId) {
            this.userSockets.delete(userId);

            // Update user offline status
            await this.usersService.updateOnlineStatus(userId, false);

            // Notify all users about offline status
            const user = await this.usersService.findOne(userId);
            this.server.emit('user_offline', { userId, lastSeen: user.lastSeen });

            // Cancel any call this user was ringing out (caller side only —
            // see CallsService.handleUserDisconnect for why ongoing calls
            // are left alone here).
            try {
                const cancelled = await this.callsService.handleUserDisconnect(userId);
                cancelled.forEach((call) => {
                    this.emitCallTermination(call.calleeId, 'call_cancelled', { callId: call.id });
                    this.logCallToChat(call);
                });
            } catch (err) {
                console.error('Call disconnect reconciliation failed:', err.message);
            }

            console.log(`User ${userId} disconnected`);
        }
    }

    // ── Call signaling ──────────────────────────────────────────────

    @SubscribeMessage('call_invite')
    async handleCallInvite(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string; calleeId: string; type: CallType },
    ) {
        const callerId = client.data.userId;
        try {
            const call = await this.callsService.initiateCall(callerId, data.conversationId, data.calleeId, data.type);

            // Include caller name/avatar so the incoming-call screen can render
            // immediately, without the callee's app needing a round trip first.
            const caller = await this.usersService.findOne(callerId);
            this.emitToUser(data.calleeId, 'call_ringing', {
                callId: call.id,
                conversationId: call.conversationId,
                callerId,
                callerName: caller.name,
                callerAvatarUrl: caller.avatarUrl
                    ? await this.s3Service.getPresignedUrl(caller.avatarUrl)
                    : null,
                type: call.type,
            });

            // Callee has no live socket (backgrounded/killed/offline) — the
            // above emit went nowhere, so this is the only way they find out.
            // Sent once per call, never repeated by the ring-timeout sweep.
            if (!this.userSockets.has(data.calleeId)) {
                this.notificationsService.sendIncomingCallPush(data.calleeId, caller.name, {
                    callId: call.id,
                    conversationId: call.conversationId,
                    type: call.type,
                }).catch((err) => console.error('Incoming-call push failed:', err.message));
            }

            return { success: true, call };
        } catch (error) {
            const reason = error?.response?.reason || error?.message || 'FAILED';
            if (reason === 'BUSY') {
                this.emitToUser(callerId, 'call_busy', { calleeId: data.calleeId });
            }
            return { success: false, reason, error: error.message };
        }
    }

    /** Reported by whichever side's ICE connection reaches "connected" first — starts the duration clock. */
    @SubscribeMessage('call_connected')
    async handleCallConnected(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { callId: string },
    ) {
        try {
            await this.callsService.markConnected(data.callId, client.data.userId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('call_accept')
    async handleCallAccept(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { callId: string },
    ) {
        const userId = client.data.userId;
        try {
            const call = await this.callsService.acceptCall(data.callId, userId);
            this.emitToUser(call.callerId, 'call_accepted', { callId: call.id, calleeId: userId });
            return { success: true, call };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('call_reject')
    async handleCallReject(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { callId: string },
    ) {
        const userId = client.data.userId;
        try {
            const call = await this.callsService.rejectCall(data.callId, userId);
            this.emitToUser(call.callerId, 'call_rejected', { callId: call.id });
            this.logCallToChat(call);
            return { success: true, call };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('call_cancel')
    async handleCallCancel(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { callId: string },
    ) {
        const userId = client.data.userId;
        try {
            const call = await this.callsService.cancelCall(data.callId, userId);
            this.emitCallTermination(call.calleeId, 'call_cancelled', { callId: call.id });
            this.logCallToChat(call);
            return { success: true, call };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('call_end')
    async handleCallEnd(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { callId: string },
    ) {
        const userId = client.data.userId;
        try {
            const call = await this.callsService.endCall(data.callId, userId);
            const otherUserId = userId === call.callerId ? call.calleeId : call.callerId;
            this.emitCallTermination(otherUserId, 'call_ended', {
                callId: call.id,
                status: call.status,
                durationSeconds: call.durationSeconds,
            });
            this.logCallToChat(call);
            return { success: true, call };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Pure WebRTC signaling relay — no DB involved, just forwards to the
     * other party's socket. The client already knows the peer's userId from
     * the call_ringing/call_accepted payload, so no lookup is needed here.
     */
    @SubscribeMessage('call_offer')
    handleCallOffer(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { callId: string; toUserId: string; sdp: any },
    ) {
        this.emitToUser(data.toUserId, 'call_offer', { callId: data.callId, sdp: data.sdp, fromUserId: client.data.userId });
    }

    @SubscribeMessage('call_answer')
    handleCallAnswer(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { callId: string; toUserId: string; sdp: any },
    ) {
        this.emitToUser(data.toUserId, 'call_answer', { callId: data.callId, sdp: data.sdp, fromUserId: client.data.userId });
    }

    @SubscribeMessage('ice_candidate')
    handleIceCandidate(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { callId: string; toUserId: string; candidate: any },
    ) {
        this.emitToUser(data.toUserId, 'ice_candidate', { callId: data.callId, candidate: data.candidate, fromUserId: client.data.userId });
    }

    /** Called from AuthController on logout — see CallsService.endActiveCallsForUser. */
    async endActiveCallsForLoggedOutUser(userId: string): Promise<void> {
        const ended = await this.callsService.endActiveCallsForUser(userId);
        ended.forEach((call) => {
            const otherUserId = userId === call.callerId ? call.calleeId : call.callerId;
            this.emitCallTermination(otherUserId, call.status === 'ended' ? 'call_ended' : 'call_cancelled', {
                callId: call.id,
                status: call.status,
                durationSeconds: call.durationSeconds,
            });
            this.logCallToChat(call);
        });
    }

    /** Ringing-timeout + stale-ongoing sweeps — see CallsService for details. */
    private async runCallMaintenanceSweep() {
        try {
            const missed = await this.callsService.sweepExpiredRingingCalls();
            missed.forEach((call) => {
                this.emitCallTermination(call.calleeId, 'call_missed', { callId: call.id });
                this.emitCallTermination(call.callerId, 'call_missed', { callId: call.id });
                this.logCallToChat(call);
            });

            const staleEnded = await this.callsService.sweepStaleOngoingCalls();
            staleEnded.forEach((call) => {
                this.emitCallTermination(call.callerId, 'call_ended', { callId: call.id, status: call.status, durationSeconds: call.durationSeconds });
                this.emitCallTermination(call.calleeId, 'call_ended', { callId: call.id, status: call.status, durationSeconds: call.durationSeconds });
                this.logCallToChat(call);
            });
        } catch (error) {
            console.error('Call maintenance sweep failed:', error.message);
        }
    }

    @SubscribeMessage('join_conversation')
    handleJoinConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        client.join(`conversation:${data.conversationId}`);
        console.log(`User ${client.data.userId} joined conversation ${data.conversationId}`);
    }

    @SubscribeMessage('leave_conversation')
    handleLeaveConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        client.leave(`conversation:${data.conversationId}`);
        console.log(`User ${client.data.userId} left conversation ${data.conversationId}`);
    }

    @SubscribeMessage('send_message')
    async handleSendMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string; text: string; type: string },
    ) {
        try {
            const userId = client.data.userId;

            // Create message via service
            const message = await this.messagesService.create(userId, {
                conversationId: data.conversationId,
                text: data.text,
                type: data.type as any,
            });

            // Emit to the room + directly to participants outside it
            await this.notifyNewMessage(message, userId);

            return { success: true, message };
        } catch (error) {
            console.error('Error sending message:', error);
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('typing_start')
    async handleTypingStart(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        await this.handleTyping(client, data, true);
    }

    @SubscribeMessage('typing_stop')
    async handleTypingStop(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        await this.handleTyping(client, data, false);
    }

    /**
     * Shared typing_start/typing_stop handler. Purely ephemeral — nothing here
     * ever touches the DB, so there's nothing to replay when a receiver
     * reconnects, and an offline participant is skipped rather than queued.
     */
    private async handleTyping(
        client: Socket,
        data: { conversationId: string },
        isTyping: boolean,
    ) {
        const userId = client.data.userId;
        if (!userId || !data?.conversationId) return;

        try {
            const participantIds = await this.conversationsService.getParticipantUserIds(data.conversationId);
            if (!participantIds.includes(userId)) return; // not authorized for this conversation

            if (isTyping) {
                this.typingBySocket.set(client.id, { userId, conversationId: data.conversationId });
            } else {
                this.typingBySocket.delete(client.id);
            }

            const event = isTyping ? 'user_typing' : 'user_stopped_typing';
            const payload = { conversationId: data.conversationId, userId };
            const room = `conversation:${data.conversationId}`;

            // Everyone currently viewing the conversation — every device of every
            // participant, private or group — gets it via the room, sender excluded.
            client.to(room).emit(event, payload);

            // Participants who are online but not in the room yet (e.g. sitting on
            // the chat list). Offline participants are skipped entirely — never queued.
            for (const participantId of participantIds) {
                if (participantId === userId) continue;
                const socketId = this.userSockets.get(participantId);
                if (!socketId) continue;
                const socket = this.server.sockets.sockets.get(socketId);
                if (socket && !socket.rooms.has(room)) {
                    socket.emit(event, payload);
                }
            }
        } catch (error) {
            console.error('Error handling typing event:', error.message);
        }
    }

    @SubscribeMessage('mark_read')
    async handleMarkRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { messageId: string; conversationId: string },
    ) {
        try {
            const userId = client.data.userId;
            const result = await this.messagesService.markAsRead(data.messageId, userId);

            if (result) {
                this.notifyStatusChange('message_read', {
                    messageId: data.messageId,
                    conversationId: result.conversationId,
                    userId,
                }, result.senderId);
            }

            return { success: true };
        } catch (error) {
            console.error('Error marking message as read:', error);
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('message_delivered')
    async handleMessageDelivered(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { messageId: string; conversationId: string },
    ) {
        try {
            const userId = client.data.userId;
            const result = await this.messagesService.markAsDelivered(data.messageId, userId);

            if (result) {
                this.notifyStatusChange('message_delivered', {
                    messageId: data.messageId,
                    conversationId: result.conversationId,
                    userId,
                }, result.senderId);
            }

            return { success: true };
        } catch (error) {
            console.error('Error marking message as delivered:', error);
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('mark_conversation_read')
    async handleMarkConversationRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        const userId = client.data.userId;
        try {
            // Update message_status rows (SENT/DELIVERED → READ)
            const updated = await this.messagesService.markConversationAsRead(data.conversationId, userId);

            // Notify each sender (in-room + direct), regardless of lastReadAt update
            updated.forEach(({ messageId, senderId }) => {
                this.notifyStatusChange('message_read', {
                    messageId,
                    conversationId: data.conversationId,
                    userId,
                }, senderId);
            });

            // Update conversation_participants.last_read_at (clears unread count in chat list)
            // Done after emitting so a DB hiccup never blocks the real-time events
            this.conversationsService.markAsRead(data.conversationId, userId).catch((err) => {
                console.error('markAsRead (lastReadAt) failed silently:', err.message);
            });

            return { success: true };
        } catch (error) {
            console.error('Error marking conversation as read:', error);
            return { success: false, error: error.message };
        }
    }

    // Helper method to emit to specific user
    emitToUser(userId: string, event: string, data: any) {
        const socketId = this.userSockets.get(userId);
        if (socketId) {
            this.server.to(socketId).emit(event, data);
        }
    }

    /**
     * Emit a call-TERMINATION event (missed/cancelled/ended/rejected) — over
     * the socket when the user has one, and additionally as a silent push when
     * they don't.
     *
     * The push half matters because a device woken by the incoming-call push
     * is showing a native CallKeep call UI while having no socket at all. If
     * only the socket path existed, that device would never hear that the call
     * is over: it keeps ringing, and the stuck Telecom connection blocks every
     * subsequent incoming call (see NotificationsService.sendCallEndedPush).
     */
    private emitCallTermination(userId: string, event: string, data: { callId: string;[k: string]: any }) {
        const socketId = this.userSockets.get(userId);
        if (socketId) {
            this.server.to(socketId).emit(event, data);
            return;
        }
        this.notificationsService
            .sendCallEndedPush(userId, data.callId)
            .catch((err) => console.error('Call-ended push failed:', err.message));
    }

    // Emit an event to everyone viewing the conversation (room members)
    emitToConversation(conversationId: string, event: string, data: any) {
        this.server.to(`conversation:${conversationId}`).emit(event, data);
    }

    /**
     * Broadcast a new message to the conversation room AND directly to every
     * online participant who is NOT in the room (e.g. sitting on the chat-list
     * screen). Without the direct emit those users would never receive
     * `new_message` — no live chat-list update and no `message_delivered`
     * receipt until they open the chat. Room members are skipped so nobody
     * gets the event twice; the sender gets the message via the ack/room.
     */
    async notifyNewMessage(message: any, senderId: string) {
        // Race-condition safety net: a message arriving always wins over a
        // stale typing indicator, whether or not the client remembered to
        // emit typing_stop first (REST send path never does).
        this.clearTypingState(senderId, message.conversationId);

        // WebSocket emits bypass the HTTP response pipeline (and therefore
        // AvatarUrlInterceptor) entirely, so the sender's avatar key has to
        // be presigned here explicitly — this is the only such spot, since
        // every other user-bearing payload in this gateway (typing, status,
        // online/offline) carries a bare userId, never a nested User object.
        if (message.sender?.avatarUrl) {
            message = {
                ...message,
                sender: {
                    ...message.sender,
                    avatarUrl: await this.s3Service.getPresignedUrl(message.sender.avatarUrl),
                },
            };
        }

        const room = `conversation:${message.conversationId}`;
        this.server.to(room).emit('new_message', message);

        try {
            const participantIds = await this.conversationsService.getParticipantUserIds(
                message.conversationId,
            );
            for (const participantId of participantIds) {
                if (participantId === senderId) continue;
                const socketId = this.userSockets.get(participantId);
                if (!socketId) continue;
                const socket = this.server.sockets.sockets.get(socketId);
                if (socket && !socket.rooms.has(room)) {
                    socket.emit('new_message', message);
                }
            }
        } catch (error) {
            console.error('notifyNewMessage fan-out failed:', error.message);
        }
    }

    /**
     * Broadcast a status change (delivered/read) to the conversation room AND
     * directly to the sender. The sender gets the event even when they're on
     * the chat-list screen (not joined to the room) — that's how ticks update
     * live everywhere. Skips the direct emit if the sender is already in the
     * room, so they never receive the event twice.
     */
    notifyStatusChange(
        event: 'message_delivered' | 'message_read',
        payload: { messageId: string; conversationId: string; userId: string },
        senderId: string,
    ) {
        this.emitToConversation(payload.conversationId, event, payload);

        const senderSocketId = this.userSockets.get(senderId);
        if (!senderSocketId) return;
        const senderSocket = this.server.sockets.sockets.get(senderSocketId);
        if (senderSocket && !senderSocket.rooms.has(`conversation:${payload.conversationId}`)) {
            senderSocket.emit(event, payload);
        }
    }

    /** Drops any in-memory typing state this user has for this conversation, across every socket/device. */
    private clearTypingState(userId: string, conversationId: string) {
        let cleared = false;
        for (const [socketId, state] of this.typingBySocket) {
            if (state.userId === userId && state.conversationId === conversationId) {
                this.typingBySocket.delete(socketId);
                cleared = true;
            }
        }
        if (cleared) {
            this.server.to(`conversation:${conversationId}`).emit('user_stopped_typing', { conversationId, userId });
        }
    }

    /**
     * Connect-time sweep: everything still SENT for this user becomes DELIVERED,
     * and every sender is notified immediately (single tick → double tick).
     */
    private async deliverPendingMessages(userId: string) {
        const delivered = await this.messagesService.markAllPendingAsDelivered(userId);

        for (const { messageId, conversationId, senderId } of delivered) {
            this.notifyStatusChange('message_delivered', { messageId, conversationId, userId }, senderId);
        }

        if (delivered.length > 0) {
            console.log(`Marked ${delivered.length} pending message(s) as delivered for user ${userId}`);
        }
    }

    /**
     * WhatsApp-style "📞 Video call, 5:32" bubble in the chat — fire-and-forget
     * from every terminal call transition (end/reject/cancel/missed-sweep/
     * stale-sweep/disconnect-cancel/logout-end). BUSY never creates a Call
     * row at all (rejected before persistence), so it's not in this map and
     * intentionally produces no message.
     */
    private async logCallToChat(call: Call) {
        const statusMap: Partial<Record<CallStatus, MessageCallStatus>> = {
            [CallStatus.ENDED]: MessageCallStatus.COMPLETED,
            [CallStatus.MISSED]: MessageCallStatus.MISSED,
            [CallStatus.REJECTED]: MessageCallStatus.REJECTED,
            [CallStatus.CANCELLED]: MessageCallStatus.CANCELLED,
        };
        const callStatus = statusMap[call.status];
        if (!callStatus) return;

        try {
            const message = await this.messagesService.createCallLogMessage(
                call.conversationId,
                call.callerId,
                call.type === CallType.VIDEO ? MessageCallType.VIDEO : MessageCallType.AUDIO,
                callStatus,
                call.status === CallStatus.ENDED ? call.durationSeconds : null,
            );
            await this.notifyNewMessage(message, call.callerId);
        } catch (err) {
            console.error('Call-log message creation failed:', err.message);
        }
    }

    private async resyncRingingCall(userId: string, client: Socket) {
        const call = await this.callsService.findActiveRingingCallForCallee(userId);
        if (!call) return;

        const caller = await this.usersService.findOne(call.callerId);
        client.emit('call_ringing', {
            callId: call.id,
            conversationId: call.conversationId,
            callerId: call.callerId,
            callerName: caller.name,
            callerAvatarUrl: caller.avatarUrl
                ? await this.s3Service.getPresignedUrl(caller.avatarUrl)
                : null,
            type: call.type,
        });
    }
}
