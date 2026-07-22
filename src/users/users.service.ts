import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import sharp from 'sharp';
import { User } from './entities/user.entity';
import { UserContact } from './entities/user-contact.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ContactItemDto } from './dto/sync-contacts.dto';
import { normalizePhoneNumber } from '../common/utils/phone.util';
import { S3Service } from '../s3/s3.service';

const AVATAR_SIZE = 512;

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,

        @InjectRepository(UserContact)
        private userContactRepository: Repository<UserContact>,

        private s3Service: S3Service,
    ) { }

    async findOne(id: string): Promise<User> {
        const user = await this.userRepository.findOne({ where: { id } });
        if (!user) {
            throw new NotFoundException('User not found');
        }
        return user;
    }

    async updateProfile(userId: string, updateProfileDto: UpdateProfileDto): Promise<User> {
        const user = await this.findOne(userId);
        user.name = updateProfileDto.name;
        if (updateProfileDto.bio !== undefined) {
            user.bio = updateProfileDto.bio;
        }
        return this.userRepository.save(user);
    }

    /**
     * Resize/compress the uploaded image and store it in S3 under a fresh
     * unique key (see S3Service.buildAvatarKey) — the old object, if any, is
     * deleted after the new one is saved so a failed upload never leaves the
     * user without an avatar. `user.avatarUrl` stores the S3 key, not a URL;
     * AvatarUrlInterceptor turns it into a presigned URL on the way out.
     */
    async updateAvatar(userId: string, buffer: Buffer): Promise<User> {
        const user = await this.findOne(userId);

        const resized = await sharp(buffer)
            .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
            .jpeg({ quality: 85 })
            .toBuffer();

        const key = this.s3Service.buildAvatarKey(userId, 'jpg');
        await this.s3Service.uploadBuffer(key, resized, 'image/jpeg');

        const previousKey = user.avatarUrl;
        user.avatarUrl = key;
        await this.userRepository.save(user);

        if (previousKey) {
            await this.s3Service.deleteObject(previousKey);
        }

        return user;
    }

    async searchUsers(query: string): Promise<User[]> {
        return this.userRepository.find({
            where: [
                { name: Like(`%${query}%`) },
                { phoneNumber: Like(`%${query}%`) },
            ],
            take: 20,
        });
    }

    async updateOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
        const user = await this.findOne(userId);
        user.isOnline = isOnline;
        if (!isOnline) {
            user.lastSeen = new Date();
        }
        await this.userRepository.save(user);
    }

    async updateFcmToken(userId: string, fcmToken: string): Promise<void> {
        await this.userRepository.update({ id: userId }, { fcmToken });
    }

    async clearFcmToken(userId: string): Promise<void> {
        await this.userRepository.update({ id: userId }, { fcmToken: null });
    }

    /**
     * Previously-synced registered contacts, read straight from user_contacts
     * (no device phonebook re-read needed). Lets a fresh install/login restore
     * contact names and the "who's on the app" list immediately, without
     * waiting on contacts permission to be re-granted and a full resync.
     */
    async getRegisteredContacts(ownerId: string): Promise<any[]> {
        const contacts = await this.userContactRepository.find({
            where: { ownerId, isRegistered: true },
            relations: ['registeredUser'],
        });

        return contacts
            .filter((c) => !!c.registeredUser)
            .map((c) => ({
                id: c.registeredUser.id,
                name: c.contactName || c.registeredUser.name,
                phoneNumber: c.registeredUser.phoneNumber,
                avatarUrl: c.registeredUser.avatarUrl,
                isOnline: c.registeredUser.isOnline,
                lastSeen: c.registeredUser.lastSeen,
            }));
    }

    /**
     * Sync a user's phone contacts with the backend.
     * Upserts all contacts into user_contacts table.
     * Returns only contacts that are registered on the app.
     */
    async syncContacts(
        ownerId: string,
        contacts: ContactItemDto[],
    ): Promise<{ registeredContacts: any[] }> {
        if (!contacts || contacts.length === 0) {
            return { registeredContacts: [] };
        }

        // Canonicalize every incoming number up front — a device contact saved
        // as "9876543210" and one saved as "+919876543210" must match the same
        // registered user. `users.phoneNumber` is always stored canonical
        // (every client path prepends +91 before OTP), so normalizing only the
        // incoming side here is enough to match correctly either way.
        const normalizedContacts = contacts.map((c) => ({
            ...c,
            normalizedPhoneNumber: normalizePhoneNumber(c.phoneNumber),
        }));

        const normalizedNumbers = normalizedContacts.map((c) => c.normalizedPhoneNumber);

        // Find which numbers are registered
        const registeredUsers = await this.userRepository.find({
            where: { phoneNumber: In(normalizedNumbers) },
            select: ['id', 'phoneNumber', 'name', 'avatarUrl', 'isOnline', 'lastSeen'],
        });

        const registeredMap = new Map(registeredUsers.map((u) => [u.phoneNumber, u]));

        // Upsert each contact — stored phone_number is now always the
        // canonical form too, so this table self-heals as users re-sync
        for (const contact of normalizedContacts) {
            const registeredUser = registeredMap.get(contact.normalizedPhoneNumber);

            const existing = await this.userContactRepository.findOne({
                where: { ownerId, phoneNumber: contact.normalizedPhoneNumber },
            });

            if (existing) {
                existing.contactName = contact.contactName;
                existing.isRegistered = !!registeredUser;
                existing.registeredUserId = registeredUser?.id ?? null;
                await this.userContactRepository.save(existing);
            } else {
                const newContact = this.userContactRepository.create({
                    ownerId,
                    phoneNumber: contact.normalizedPhoneNumber,
                    contactName: contact.contactName,
                    isRegistered: !!registeredUser,
                    registeredUserId: registeredUser?.id ?? undefined,
                });
                await this.userContactRepository.save(newContact);
            }
        }

        // Return registered contacts with phone-book name preferred
        const registeredContacts = normalizedContacts
            .filter((c) => registeredMap.has(c.normalizedPhoneNumber))
            .map((c) => {
                const user = registeredMap.get(c.normalizedPhoneNumber)!;
                return {
                    id: user.id,
                    name: c.contactName || user.name,
                    phoneNumber: user.phoneNumber,
                    avatarUrl: user.avatarUrl,
                    isOnline: user.isOnline,
                    lastSeen: user.lastSeen,
                };
            })
            .filter((c) => c.id !== ownerId); // exclude self

        return { registeredContacts };
    }
}
