import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Message } from '../../messages/entities/message.entity';
import { ConversationParticipant } from '../../conversations/entities/conversation-participant.entity';

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true, name: 'phone_number' })
    phoneNumber: string;

    @Column()
    name: string;

    @Column({ nullable: true, type: 'text' })
    bio: string;

    @Column({ nullable: true, name: 'avatar_url' })
    avatarUrl: string;

    @Column({ default: false, name: 'is_online' })
    isOnline: boolean;

    @Column({ nullable: true, type: 'timestamp', name: 'last_seen' })
    lastSeen: Date;

    @Column({ nullable: true, type: 'varchar', length: 512, name: 'fcm_token' })
    fcmToken: string | null;

    @Column({ default: true, name: 'is_active' })
    isActive: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @OneToMany(() => Message, message => message.sender)
    sentMessages: Message[];

    @OneToMany(() => ConversationParticipant, participant => participant.user)
    conversations: ConversationParticipant[];
}
