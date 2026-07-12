import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_contacts')
@Index(['ownerId', 'phoneNumber'], { unique: true })
export class UserContact {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'owner_id' })
    ownerId: string;

    @Column({ name: 'phone_number' })
    phoneNumber: string;

    @Column({ name: 'contact_name' })
    contactName: string;

    @Column({ default: false, name: 'is_registered' })
    isRegistered: boolean;

    @Column({ nullable: true, name: 'registered_user_id' })
    registeredUserId: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'owner_id' })
    owner: User;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'registered_user_id' })
    registeredUser: User;
}
