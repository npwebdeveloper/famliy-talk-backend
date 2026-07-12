import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './entities/message.entity';
import { MessageStatus, MessageStatusType } from './entities/message-status.entity';
import { ConversationParticipant } from '../conversations/entities/conversation-participant.entity';
import { CreateMessageDto } from './dto/create-message.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MessagesService {
    constructor(
        @InjectRepository(Message)
        private messageRepository: Repository<Message>,
        @InjectRepository(MessageStatus)
        private messageStatusRepository: Repository<MessageStatus>,
        @InjectRepository(ConversationParticipant)
        private participantRepository: Repository<ConversationParticipant>,
        private notificationsService: NotificationsService,
    ) { }

    async create(userId: string, createMessageDto: CreateMessageDto): Promise<Message> {
        const { conversationId, text, type, mediaUrl } = createMessageDto;

        const isParticipant = await this.participantRepository.findOne({
            where: { conversationId, userId },
        });

        if (!isParticipant) {
            throw new ForbiddenException('You are not a participant of this conversation');
        }

        const message = this.messageRepository.create({
            conversationId,
            senderId: userId,
            text,
            type,
            mediaUrl,
        });

        await this.messageRepository.save(message);

        // Create SENT status for all other participants
        const participants = await this.participantRepository.find({
            where: { conversationId },
        });

        const statuses = participants
            .filter(p => p.userId !== userId)
            .map(p =>
                this.messageStatusRepository.create({
                    messageId: message.id,
                    userId: p.userId,
                    status: MessageStatusType.SENT,
                }),
            );

        await this.messageStatusRepository.save(statuses);

        const savedMessage = await this.messageRepository.findOne({
            where: { id: message.id },
            relations: ['sender', 'statuses'],
        });

        if (!savedMessage) throw new Error('Failed to retrieve saved message');

        // Push notification to offline recipients (fire-and-forget — never blocks the send).
        // Privacy: only sender name goes in the push, never the message content.
        const recipientIds = participants.filter(p => p.userId !== userId).map(p => p.userId);
        this.notificationsService
            .sendNewMessagePush(
                recipientIds,
                savedMessage.sender?.name || 'Family Talk',
                { conversationId, messageId: savedMessage.id },
            )
            .catch(err => console.error('New-message push failed:', err.message));

        return savedMessage;
    }

    async findByConversation(
        conversationId: string,
        userId: string,
        page: number = 1,
        limit: number = 50,
    ): Promise<{ messages: Message[]; total: number }> {
        const isParticipant = await this.participantRepository.findOne({
            where: { conversationId, userId },
        });

        if (!isParticipant) {
            throw new ForbiddenException('You are not a participant of this conversation');
        }

        const skip = (page - 1) * limit;

        const [messages, total] = await this.messageRepository.findAndCount({
            where: { conversationId },
            relations: ['sender', 'statuses'],
            order: { createdAt: 'DESC' },
            skip,
            take: limit,
        });

        return { messages: messages.reverse(), total };
    }

    /**
     * Mark a single message as delivered for a recipient (SENT → DELIVERED only;
     * never downgrades READ). Returns sender/conversation info so the gateway
     * can notify the sender in real-time, or null if nothing changed.
     */
    async markAsDelivered(
        messageId: string,
        userId: string,
    ): Promise<{ senderId: string; conversationId: string } | null> {
        const status = await this.messageStatusRepository.findOne({
            where: { messageId, userId },
            relations: ['message'],
        });

        if (!status || status.status !== MessageStatusType.SENT) return null;

        status.status = MessageStatusType.DELIVERED;
        status.deliveredAt = new Date();
        await this.messageStatusRepository.save(status);

        return { senderId: status.message.senderId, conversationId: status.message.conversationId };
    }

    /**
     * Mark a single message as read for a recipient. Returns sender/conversation
     * info so the caller can notify the sender, or null if already read / no status.
     */
    async markAsRead(
        messageId: string,
        userId: string,
    ): Promise<{ senderId: string; conversationId: string } | null> {
        const status = await this.messageStatusRepository.findOne({
            where: { messageId, userId },
            relations: ['message'],
        });

        if (!status || status.status === MessageStatusType.READ) return null;

        status.status = MessageStatusType.READ;
        status.readAt = new Date();
        if (!status.deliveredAt) status.deliveredAt = new Date(); // read implies delivered
        await this.messageStatusRepository.save(status);

        return { senderId: status.message.senderId, conversationId: status.message.conversationId };
    }

    /**
     * Mark all unread messages in a conversation as read for a user.
     * Returns the updated messages with their senderIds (so gateway can notify senders).
     */
    async markConversationAsRead(
        conversationId: string,
        userId: string,
    ): Promise<Array<{ messageId: string; senderId: string }>> {
        const statuses = await this.messageStatusRepository
            .createQueryBuilder('ms')
            .innerJoinAndSelect('ms.message', 'm')
            .where('m.conversation_id = :conversationId', { conversationId })
            .andWhere('ms.user_id = :userId', { userId })
            .andWhere('ms.status != :status', { status: MessageStatusType.READ })
            .getMany();

        if (statuses.length === 0) return [];

        await this.messageStatusRepository
            .createQueryBuilder()
            .update(MessageStatus)
            .set({
                status: MessageStatusType.READ,
                readAt: () => 'CURRENT_TIMESTAMP',
                deliveredAt: () => 'COALESCE(delivered_at, CURRENT_TIMESTAMP)',
            })
            .where('id IN (:...ids)', { ids: statuses.map(s => s.id) })
            .execute();

        return statuses.map(s => ({ messageId: s.messageId, senderId: s.message.senderId }));
    }

    /**
     * Mark ALL pending (SENT) messages for a user as DELIVERED, across every
     * conversation. Called when the user's socket connects — this is what turns
     * the sender's single tick into a double tick the moment the recipient's
     * device comes online (even if they never open the chat).
     */
    async markAllPendingAsDelivered(
        userId: string,
    ): Promise<Array<{ messageId: string; conversationId: string; senderId: string }>> {
        const statuses = await this.messageStatusRepository
            .createQueryBuilder('ms')
            .innerJoinAndSelect('ms.message', 'm')
            .where('ms.user_id = :userId', { userId })
            .andWhere('ms.status = :status', { status: MessageStatusType.SENT })
            .getMany();

        if (statuses.length === 0) return [];

        await this.messageStatusRepository
            .createQueryBuilder()
            .update(MessageStatus)
            .set({
                status: MessageStatusType.DELIVERED,
                deliveredAt: () => 'CURRENT_TIMESTAMP',
            })
            .where('id IN (:...ids)', { ids: statuses.map(s => s.id) })
            .execute();

        return statuses.map(s => ({
            messageId: s.messageId,
            conversationId: s.message.conversationId,
            senderId: s.message.senderId,
        }));
    }

    async delete(messageId: string, userId: string): Promise<void> {
        const message = await this.messageRepository.findOne({
            where: { id: messageId },
        });

        if (!message) throw new NotFoundException('Message not found');
        if (message.senderId !== userId) throw new ForbiddenException('You can only delete your own messages');

        await this.messageRepository.remove(message);
    }
}
