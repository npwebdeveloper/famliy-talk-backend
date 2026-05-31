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
import { UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';

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

            console.log(`User ${userId} connected with socket ${client.id}`);
        } catch (error) {
            console.error('Connection error:', error.message);
            console.error('Stack trace:', error.stack);
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

            await this.messagesService.markAsRead(data.messageId, userId);

            // Notify sender about read receipt
            this.server.to(`conversation:${data.conversationId}`).emit('message_read', {
                messageId: data.messageId,
                userId,
            });

            return { success: true };
        } catch (error) {
            console.error('Error marking message as read:', error);
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
}
