import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Message } from '../../messages/entities/message.entity';
import { ConversationParticipant } from './conversation-participant.entity';

export enum ConversationType {
    PRIVATE = 'private',
    GROUP = 'group',
}

@Entity('conversations')
export class Conversation {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({
        type: 'enum',
        enum: ConversationType,
        default: ConversationType.PRIVATE,
    })
    type: ConversationType;

    @Column({ nullable: true })
    name: string;

    @Column({ nullable: true, name: 'avatar_url' })
    avatarUrl: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @OneToMany(() => Message, message => message.conversation)
    messages: Message[];

    @OneToMany(() => ConversationParticipant, participant => participant.conversation)
    participants: ConversationParticipant[];
}
