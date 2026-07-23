import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { User } from '../../users/entities/user.entity';

export enum CallType {
    AUDIO = 'audio',
    VIDEO = 'video',
}

export enum CallStatus {
    RINGING = 'ringing',
    ONGOING = 'ongoing',
    ENDED = 'ended',
    MISSED = 'missed',
    REJECTED = 'rejected',
    CANCELLED = 'cancelled',
    BUSY = 'busy',
}

@Entity('calls')
export class Call {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'conversation_id' })
    @Index()
    conversationId: string;

    @Column({ name: 'caller_id' })
    callerId: string;

    @Column({ name: 'callee_id' })
    calleeId: string;

    @Column({ type: 'enum', enum: CallType })
    type: CallType;

    @Column({ type: 'enum', enum: CallStatus, default: CallStatus.RINGING })
    @Index()
    status: CallStatus;

    @Column({ nullable: true, type: 'timestamp', name: 'started_at' })
    startedAt: Date | null;

    @Column({ nullable: true, type: 'timestamp', name: 'ended_at' })
    endedAt: Date | null;

    @Column({ nullable: true, type: 'int', name: 'duration_seconds' })
    durationSeconds: number | null;

    /** Client-reported connection health — see CallsController#reportStats. */
    @Column({ default: 0, type: 'int', name: 'ice_failures' })
    iceFailures: number;

    @Column({ default: 0, type: 'int', name: 'reconnect_count' })
    reconnectCount: number;

    @Column({ nullable: true, type: 'varchar', length: 32, name: 'final_ice_state' })
    finalIceState: string | null;

    @CreateDateColumn({ name: 'created_at' })
    @Index()
    createdAt: Date;

    @ManyToOne(() => Conversation)
    @JoinColumn({ name: 'conversation_id' })
    conversation: Conversation;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'caller_id' })
    caller: User;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'callee_id' })
    callee: User;
}
