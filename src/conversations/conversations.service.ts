import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Conversation, ConversationType } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { CreateConversationDto } from './dto/create-conversation.dto';

@Injectable()
export class ConversationsService {
    constructor(
        @InjectRepository(Conversation)
        private conversationRepository: Repository<Conversation>,
        @InjectRepository(ConversationParticipant)
        private participantRepository: Repository<ConversationParticipant>,
    ) { }

    async create(userId: string, createConversationDto: CreateConversationDto): Promise<Conversation> {
        const { participantIds } = createConversationDto;

        // Add current user to participants
        const allParticipantIds = [...new Set([userId, ...participantIds])];

        // Check if private conversation already exists
        if (allParticipantIds.length === 2) {
            const existingConversation = await this.findPrivateConversation(allParticipantIds[0], allParticipantIds[1]);
            if (existingConversation) {
                return existingConversation;
            }
        }

        // Create new conversation
        const conversation = this.conversationRepository.create({
            type: allParticipantIds.length === 2 ? ConversationType.PRIVATE : ConversationType.GROUP,
        });

        await this.conversationRepository.save(conversation);

        // Add participants
        const participants = allParticipantIds.map(participantId =>
            this.participantRepository.create({
                conversationId: conversation.id,
                userId: participantId,
            }),
        );

        await this.participantRepository.save(participants);

        return this.findOne(conversation.id, userId);
    }

    async findAll(userId: string, page: number = 1, limit: number = 20): Promise<{ conversations: Conversation[]; total: number }> {
        const skip = (page - 1) * limit;

        const participantRecords = await this.participantRepository.find({
            where: { userId },
            relations: ['conversation', 'conversation.participants', 'conversation.participants.user', 'conversation.messages'],
            order: { conversation: { updatedAt: 'DESC' } },
            skip,
            take: limit,
        });

        const conversations = participantRecords.map(p => p.conversation);
        const total = await this.participantRepository.count({ where: { userId } });

        return { conversations, total };
    }

    async findOne(id: string, userId: string): Promise<Conversation> {
        const conversation = await this.conversationRepository.findOne({
            where: { id },
            relations: ['participants', 'participants.user', 'messages'],
        });

        if (!conversation) {
            throw new NotFoundException('Conversation not found');
        }

        // Check if user is a participant
        const isParticipant = conversation.participants.some(p => p.userId === userId);
        if (!isParticipant) {
            throw new ForbiddenException('You are not a participant of this conversation');
        }

        return conversation;
    }

    async markAsRead(conversationId: string, userId: string): Promise<void> {
        const participant = await this.participantRepository.findOne({
            where: { conversationId, userId },
        });

        if (!participant) {
            throw new NotFoundException('Participant not found');
        }

        participant.lastReadAt = new Date();
        await this.participantRepository.save(participant);
    }

    private async findPrivateConversation(userId1: string, userId2: string): Promise<Conversation | null> {
        const conversations = await this.participantRepository
            .createQueryBuilder('cp1')
            .innerJoin('conversation_participants', 'cp2', 'cp1.conversation_id = cp2.conversation_id')
            .innerJoin('conversations', 'c', 'c.id = cp1.conversation_id')
            .where('cp1.user_id = :userId1', { userId1 })
            .andWhere('cp2.user_id = :userId2', { userId2 })
            .andWhere('c.type = :type', { type: ConversationType.PRIVATE })
            .select('cp1.conversation_id')
            .getRawMany();

        if (conversations.length > 0) {
            return this.conversationRepository.findOne({
                where: { id: conversations[0].cp1_conversation_id },
                relations: ['participants', 'participants.user'],
            });
        }

        return null;
    }
}
