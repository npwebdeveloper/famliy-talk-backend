import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, MessageType } from './entities/message.entity';
import { MessageStatus, MessageStatusType } from './entities/message-status.entity';
import { ConversationParticipant } from '../conversations/entities/conversation-participant.entity';
import { CreateMessageDto } from './dto/create-message.dto';

@Injectable()
export class MessagesService {
    constructor(
        @InjectRepository(Message)
        private messageRepository: Repository<Message>,
        @InjectRepository(MessageStatus)
        private messageStatusRepository: Repository<MessageStatus>,
        @InjectRepository(ConversationParticipant)
        private participantRepository: Repository<ConversationParticipant>,
    ) { }

    async create(userId: string, createMessageDto: CreateMessageDto): Promise<Message> {
        const { conversationId, text, type, mediaUrl } = createMessageDto;

        // Verify user is a participant
        const isParticipant = await this.participantRepository.findOne({
            where: { conversationId, userId },
        });

        if (!isParticipant) {
            throw new ForbiddenException('You are not a participant of this conversation');
        }

        // Create message
        const message = this.messageRepository.create({
            conversationId,
            senderId: userId,
            text,
            type,
            mediaUrl,
        });

        await this.messageRepository.save(message);

        // Create message statuses for all participants except sender
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

        if (!savedMessage) {
            throw new Error('Failed to retrieve saved message');
        }

        return savedMessage;
    }

    async findByConversation(
        conversationId: string,
        userId: string,
        page: number = 1,
        limit: number = 50,
    ): Promise<{ messages: Message[]; total: number }> {
        // Verify user is a participant
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

    async markAsRead(messageId: string, userId: string): Promise<void> {
        const message = await this.messageRepository.findOne({
            where: { id: messageId },
        });

        if (!message) {
            throw new NotFoundException('Message not found');
        }

        // Find or create message status
        let status = await this.messageStatusRepository.findOne({
            where: { messageId, userId },
        });

        if (status) {
            status.status = MessageStatusType.READ;
            status.timestamp = new Date();
            await this.messageStatusRepository.save(status);
        }
    }

    async delete(messageId: string, userId: string): Promise<void> {
        const message = await this.messageRepository.findOne({
            where: { id: messageId },
        });

        if (!message) {
            throw new NotFoundException('Message not found');
        }

        if (message.senderId !== userId) {
            throw new ForbiddenException('You can only delete your own messages');
        }

        await this.messageRepository.remove(message);
    }
}
