import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { User } from '../../users/entities/user.entity';
import { MessageStatus } from './message-status.entity';

export enum MessageType {
    TEXT = 'text',
    IMAGE = 'image',
    VIDEO = 'video',
    AUDIO = 'audio',
}

@Entity('messages')
export class Message {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'conversation_id' })
    @Index()
    conversationId: string;

    @Column({ name: 'sender_id' })
    senderId: string;

    @Column({ nullable: true, type: 'text' })
    text: string;

    @Column({
        type: 'enum',
        enum: MessageType,
        default: MessageType.TEXT,
    })
    type: MessageType;

    @Column({ nullable: true, name: 'media_url' })
    mediaUrl: string;

    @CreateDateColumn({ name: 'created_at' })
    @Index()
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @ManyToOne(() => Conversation, conversation => conversation.messages)
    @JoinColumn({ name: 'conversation_id' })
    conversation: Conversation;

    @ManyToOne(() => User, user => user.sentMessages)
    @JoinColumn({ name: 'sender_id' })
    sender: User;

    @OneToMany(() => MessageStatus, status => status.message)
    statuses: MessageStatus[];
}
