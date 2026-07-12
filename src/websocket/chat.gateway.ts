import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';
import { ConversationsService } from '../conversations/conversations.service';

@WebSocketGateway({
    cors: {
        origin: '*', // Configure this properly in production
        credentials: true,
    },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private userSockets: Map<string, string> = new Map(); // userId -> socketId

    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
        private messagesService: MessagesService,
        private usersService: UsersService,
        private conversationsService: ConversationsService,
    ) { }

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

        if (userId) {
            this.userSockets.delete(userId);

            // Update user offline status
            await this.usersService.updateOnlineStatus(userId, false);

            // Notify all users about offline status
            const user = await this.usersService.findOne(userId);
            this.server.emit('user_offline', { userId, lastSeen: user.lastSeen });

            console.log(`User ${userId} disconnected`);
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

            // Emit to all users in the conversation
            this.server.to(`conversation:${data.conversationId}`).emit('new_message', message);

            return { success: true, message };
        } catch (error) {
            console.error('Error sending message:', error);
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('typing_start')
    handleTypingStart(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        const userId = client.data.userId;
        client.to(`conversation:${data.conversationId}`).emit('user_typing', {
            conversationId: data.conversationId,
            userId,
        });
    }

    @SubscribeMessage('typing_stop')
    handleTypingStop(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        const userId = client.data.userId;
        client.to(`conversation:${data.conversationId}`).emit('user_stopped_typing', {
            conversationId: data.conversationId,
            userId,
        });
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

    // Emit an event to everyone viewing the conversation (room members)
    emitToConversation(conversationId: string, event: string, data: any) {
        this.server.to(`conversation:${conversationId}`).emit(event, data);
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
}
