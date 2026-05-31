import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from '../../users/entities/user.entity';

@Entity('conversation_participants')
@Index(['conversationId', 'userId'], { unique: true })
export class ConversationParticipant {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'conversation_id' })
    conversationId: string;

    @Column({ name: 'user_id' })
    userId: string;

    @CreateDateColumn({ name: 'joined_at' })
    joinedAt: Date;

    @Column({ nullable: true, type: 'timestamp', name: 'last_read_at' })
    lastReadAt: Date;

    @ManyToOne(() => Conversation, conversation => conversation.participants)
    @JoinColumn({ name: 'conversation_id' })
    conversation: Conversation;

    @ManyToOne(() => User, user => user.conversations)
    @JoinColumn({ name: 'user_id' })
    user: User;
}
