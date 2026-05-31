import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('otp_verifications')
export class OtpVerification {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'phone_number' })
    phoneNumber: string;

    @Column({ name: 'otp_code' })
    otpCode: string;

    @Column({ type: 'timestamp', name: 'expires_at' })
    expiresAt: Date;

    @Column({ default: false, name: 'is_verified' })
    isVerified: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
