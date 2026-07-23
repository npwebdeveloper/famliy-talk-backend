import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';

@Entity('user_blocks')
@Index(['blockerId', 'blockedId'], { unique: true })
export class UserBlock {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'blocker_id' })
    blockerId: string;

    @Column({ name: 'blocked_id' })
    blockedId: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'blocker_id' })
    blocker: User;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'blocked_id' })
    blocked: User;
}
