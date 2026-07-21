import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/entities/user.entity';
import { UserContact } from '../users/entities/user-contact.entity';
import { OtpVerification } from './entities/otp-verification.entity';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizePhoneNumber } from '../common/utils/phone.util';

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(OtpVerification)
        private otpRepository: Repository<OtpVerification>,
        @InjectRepository(UserContact)
        private userContactRepository: Repository<UserContact>,
        private jwtService: JwtService,
        private configService: ConfigService,
        private notificationsService: NotificationsService,
    ) { }

    async sendOtp(sendOtpDto: SendOtpDto) {
        const { phoneNumber } = sendOtpDto;

        // Check rate limiting - max 3 OTPs per hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentOtps = await this.otpRepository.count({
            where: {
                phoneNumber,
                createdAt: MoreThan(oneHourAgo),
            },
        });

        if (recentOtps >= 3) {
            throw new BadRequestException('Too many OTP requests. Please try again later.');
        }

        // Use static OTP for development
        const otpCode = this.configService.get<string>('STATIC_OTP') || '123456';
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        // Save OTP to database
        const otpVerification = this.otpRepository.create({
            phoneNumber,
            otpCode,
            expiresAt,
        });

        await this.otpRepository.save(otpVerification);

        // In production, send SMS here via Twilio/AWS SNS
        console.log(`OTP for ${phoneNumber}: ${otpCode}`);

        // Lets the client show a "you're already registered with this
        // number, continue?" prompt (e.g. after a reinstall) before moving
        // to the OTP screen — no profile data is returned, just the flag,
        // to avoid leaking who's registered to an unauthenticated caller.
        const existingUser = await this.userRepository.findOne({
            where: { phoneNumber },
            select: ['id'],
        });

        return {
            success: true,
            message: 'OTP sent successfully',
            isExistingUser: !!existingUser,
        };
    }

    async verifyOtp(verifyOtpDto: VerifyOtpDto) {
        const { phoneNumber, otp } = verifyOtpDto;

        // Find the most recent valid OTP
        const otpVerification = await this.otpRepository.findOne({
            where: {
                phoneNumber,
                otpCode: otp,
                isVerified: false,
                expiresAt: MoreThan(new Date()),
            },
            order: {
                createdAt: 'DESC',
            },
        });

        if (!otpVerification) {
            throw new UnauthorizedException('Invalid or expired OTP');
        }

        // Mark OTP as verified
        otpVerification.isVerified = true;
        await this.otpRepository.save(otpVerification);

        // Find or create user
        let user = await this.userRepository.findOne({ where: { phoneNumber } });
        const isNewUser = !user;

        if (!user) {
            user = this.userRepository.create({
                phoneNumber,
                name: '', // Will be set during profile creation
                isOnline: true,
            });
            await this.userRepository.save(user);
        } else {
            // Update online status
            user.isOnline = true;
            await this.userRepository.save(user);
        }

        // If this is a new registration, mark any saved contacts as registered
        if (isNewUser) {
            // user_contacts.phone_number is canonicalized at sync time
            // (see UsersService.syncContacts) — match on that same form here.
            const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

            // Grab the rows first — we need the owners (and their saved name for this
            // contact) to send them a "your contact joined" push after the update
            const matchingContacts = await this.userContactRepository.find({
                where: { phoneNumber: normalizedPhoneNumber, isRegistered: false },
                select: ['ownerId', 'contactName'],
            });

            await this.userContactRepository
                .createQueryBuilder()
                .update(UserContact)
                .set({ isRegistered: true, registeredUserId: user.id })
                .where('phone_number = :normalizedPhoneNumber AND is_registered = false', { normalizedPhoneNumber })
                .execute();

            // Notify everyone who had this number saved (fire-and-forget)
            for (const contact of matchingContacts) {
                this.notificationsService
                    .sendContactJoinedPush(contact.ownerId, contact.contactName || phoneNumber, user.id)
                    .catch(err => console.error('Contact-joined push failed:', err.message));
            }
        }

        // Generate JWT tokens
        const tokens = await this.generateTokens(user.id, user.phoneNumber);

        return {
            success: true,
            ...tokens,
            user: {
                id: user.id,
                phoneNumber: user.phoneNumber,
                name: user.name,
                bio: user.bio,
                avatarUrl: user.avatarUrl,
                isOnline: user.isOnline,
            },
        };
    }

    async refreshToken(refreshToken: string) {
        try {
            const payload = this.jwtService.verify(refreshToken, {
                secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'default-refresh-secret',
            });

            const user = await this.userRepository.findOne({ where: { id: payload.sub } });

            if (!user) {
                throw new UnauthorizedException('User not found');
            }

            const tokens = await this.generateTokens(user.id, user.phoneNumber);
            return tokens;
        } catch (error) {
            throw new UnauthorizedException('Invalid refresh token');
        }
    }

    async logout(userId: string) {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (user) {
            user.isOnline = false;
            user.lastSeen = new Date();
            user.fcmToken = null; // stop push notifications after logout
            await this.userRepository.save(user);
        }

        return { success: true, message: 'Logged out successfully' };
    }

    private async generateTokens(userId: string, phoneNumber: string) {
        const payload = { sub: userId, phoneNumber };

        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(payload, {
                secret: this.configService.get<string>('JWT_SECRET') || 'default-secret',
                expiresIn: (this.configService.get<string>('JWT_EXPIRES_IN') || '1h') as any,
            }),
            this.jwtService.signAsync(payload, {
                secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'default-refresh-secret',
                expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as any,
            }),
        ]);

        return {
            accessToken,
            refreshToken,
        };
    }

    async validateUser(userId: string): Promise<User> {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) {
            throw new UnauthorizedException('User not found');
        }
        return user;
    }
}
