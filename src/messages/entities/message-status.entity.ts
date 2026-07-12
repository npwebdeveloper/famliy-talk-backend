import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Message } from './message.entity';
import { User } from '../../users/entities/user.entity';

export enum MessageStatusType {
    SENT = 'sent',
    DELIVERED = 'delivered',
    READ = 'read',
}

@Entity('message_status')
@Index(['messageId', 'userId'], { unique: true })
export class MessageStatus {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'message_id' })
    messageId: string;

    @Column({ name: 'user_id' })
    userId: string;

    @Column({
        type: 'enum',
        enum: MessageStatusType,
        default: MessageStatusType.SENT,
    })
    status: MessageStatusType;

    @CreateDateColumn({ type: 'timestamp' })
    timestamp: Date;

    @Column({ nullable: true, type: 'timestamp', name: 'delivered_at' })
    deliveredAt: Date | null;

    @Column({ nullable: true, type: 'timestamp', name: 'read_at' })
    readAt: Date | null;

    @ManyToOne(() => Message, message => message.statuses)
    @JoinColumn({ name: 'message_id' })
    message: Message;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'user_id' })
    user: User;
}
