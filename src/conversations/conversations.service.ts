import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Conversation, ConversationType } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { Message } from '../messages/entities/message.entity';
import { MessageStatus, MessageStatusType } from '../messages/entities/message-status.entity';

@Injectable()
export class ConversationsService {
    constructor(
        @InjectRepository(Conversation)
        private conversationRepository: Repository<Conversation>,
        @InjectRepository(ConversationParticipant)
        private participantRepository: Repository<ConversationParticipant>,
        @InjectRepository(Message)
        private messageRepository: Repository<Message>,
        @InjectRepository(MessageStatus)
        private messageStatusRepository: Repository<MessageStatus>,
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

    /** Lightweight participant lookup (no relations) — used for socket fan-out */
    async getParticipantUserIds(conversationId: string): Promise<string[]> {
        const participants = await this.participantRepository.find({
            where: { conversationId },
            select: ['userId'],
        });
        return participants.map((p) => p.userId);
    }

    /**
     * List the user's conversations ordered by most recent activity (latest
     * message time) — not by `conversation.updatedAt`, which is never
     * touched when a message is inserted into a different table.
     *
     * Conversations with zero messages are excluded entirely. Opening a
     * contact's chat screen creates the conversation row immediately (so a
     * conversationId exists to send into), but until a message actually
     * gets sent it isn't a "chat" yet — otherwise every contact whose
     * profile you've merely opened would clutter the list, sorted as the
     * most recent activity since its createdAt is "now".
     */
    async findAll(userId: string, page: number = 1, limit: number = 20): Promise<{ conversations: any[]; total: number }> {
        const skip = (page - 1) * limit;

        const participantRecords = await this.participantRepository.find({
            where: { userId },
        });

        if (participantRecords.length === 0) {
            return { conversations: [], total: 0 };
        }

        const allConversationIds = participantRecords.map(p => p.conversationId);

        const latestMessageTimes = await this.messageRepository
            .createQueryBuilder('m')
            .select('m.conversation_id', 'conversationId')
            .addSelect('MAX(m.created_at)', 'lastMessageAt')
            .where('m.conversation_id IN (:...ids)', { ids: allConversationIds })
            .groupBy('m.conversation_id')
            .getRawMany<{ conversationId: string; lastMessageAt: string }>();

        const lastActivityMap = new Map(
            latestMessageTimes.map(row => [row.conversationId, new Date(row.lastMessageAt).getTime()]),
        );

        const activeIds = allConversationIds.filter(id => lastActivityMap.has(id));
        const total = activeIds.length;

        if (total === 0) {
            return { conversations: [], total: 0 };
        }

        const sortedIds = activeIds
            .slice()
            .sort((a, b) => lastActivityMap.get(b)! - lastActivityMap.get(a)!);

        const pageIds = sortedIds.slice(skip, skip + limit);

        if (pageIds.length === 0) {
            return { conversations: [], total };
        }

        const [conversationEntities, lastMessages, unreadCounts] = await Promise.all([
            this.conversationRepository.find({
                where: { id: In(pageIds) },
                relations: ['participants', 'participants.user'],
            }),
            this.getLastMessages(pageIds),
            this.getUnreadCounts(pageIds, userId),
        ]);
        const byId = new Map(conversationEntities.map(c => [c.id, c]));

        const conversations = pageIds
            .map(id => byId.get(id))
            .filter((c): c is Conversation => !!c)
            .map(conversation => ({
                ...conversation,
                lastMessage: lastMessages.get(conversation.id) ?? null,
                unreadCount: unreadCounts.get(conversation.id) ?? 0,
            }));

        return { conversations, total };
    }

    /** Single most recent message per conversation (with sender + statuses for the tick). */
    private async getLastMessages(conversationIds: string[]): Promise<Map<string, Message>> {
        const results = await Promise.all(
            conversationIds.map(id =>
                this.messageRepository.findOne({
                    where: { conversationId: id },
                    order: { createdAt: 'DESC' },
                    relations: ['sender', 'statuses'],
                }),
            ),
        );

        const map = new Map<string, Message>();
        conversationIds.forEach((id, idx) => {
            const message = results[idx];
            if (message) map.set(id, message);
        });
        return map;
    }

    /**
     * Unread count sourced from message_status (the same table that drives read
     * receipts) rather than a client-side createdAt/lastReadAt comparison — so
     * the badge can never drift from what "read" actually means for a message.
     */
    private async getUnreadCounts(conversationIds: string[], userId: string): Promise<Map<string, number>> {
        const rows = await this.messageStatusRepository
            .createQueryBuilder('ms')
            .innerJoin('ms.message', 'm')
            .select('m.conversation_id', 'conversationId')
            .addSelect('COUNT(*)', 'count')
            .where('ms.user_id = :userId', { userId })
            .andWhere('ms.status != :status', { status: MessageStatusType.READ })
            .andWhere('m.conversation_id IN (:...ids)', { ids: conversationIds })
            .groupBy('m.conversation_id')
            .getRawMany<{ conversationId: string; count: string }>();

        return new Map(rows.map(r => [r.conversationId, parseInt(r.count, 10)]));
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
            .select('cp1.conversation_id', 'conversationId')
            .getRawMany();

        if (conversations.length > 0) {
            return this.conversationRepository.findOne({
                where: { id: conversations[0].conversationId },
                relations: ['participants', 'participants.user'],
            });
        }

        return null;
    }
}
