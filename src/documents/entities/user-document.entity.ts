import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * A private file a user uploaded for themselves. `s3Key` points at an object
 * under the bucket's `personal/` prefix and is never sent to the client — it
 * exists so the download endpoint can fetch the object *after* confirming
 * `ownerId` matches the caller. Named UserDocument rather than Document to
 * avoid shadowing the DOM `Document` type.
 */
@Entity('documents')
@Index(['ownerId', 'createdAt'])
export class UserDocument {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'owner_id' })
    ownerId: string;

    @Column({ name: 's3_key' })
    s3Key: string;

    @Column({ name: 'original_name' })
    originalName: string;

    @Column({ name: 'mime_type' })
    mimeType: string;

    /** Size in bytes. Capped at 20MB on upload, so int is plenty. */
    @Column({ type: 'int' })
    size: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'owner_id' })
    owner: User;
}
