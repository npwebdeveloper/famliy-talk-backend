import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { User } from './entities/user.entity';
import { UserContact } from './entities/user-contact.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ContactItemDto } from './dto/sync-contacts.dto';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,

        @InjectRepository(UserContact)
        private userContactRepository: Repository<UserContact>,
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

    async updateAvatar(userId: string, avatarUrl: string): Promise<User> {
        const user = await this.findOne(userId);
        user.avatarUrl = avatarUrl;
        return this.userRepository.save(user);
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

        const phoneNumbers = contacts.map((c) => c.phoneNumber);

        // Find which numbers are registered
        const registeredUsers = await this.userRepository.find({
            where: { phoneNumber: In(phoneNumbers) },
            select: ['id', 'phoneNumber', 'name', 'avatarUrl', 'isOnline', 'lastSeen'],
        });

        const registeredMap = new Map(registeredUsers.map((u) => [u.phoneNumber, u]));

        // Upsert each contact
        for (const contact of contacts) {
            const registeredUser = registeredMap.get(contact.phoneNumber);

            const existing = await this.userContactRepository.findOne({
                where: { ownerId, phoneNumber: contact.phoneNumber },
            });

            if (existing) {
                existing.contactName = contact.contactName;
                existing.isRegistered = !!registeredUser;
                existing.registeredUserId = registeredUser?.id ?? null;
                await this.userContactRepository.save(existing);
            } else {
                const newContact = this.userContactRepository.create({
                    ownerId,
                    phoneNumber: contact.phoneNumber,
                    contactName: contact.contactName,
                    isRegistered: !!registeredUser,
                    registeredUserId: registeredUser?.id ?? undefined,
                });
                await this.userContactRepository.save(newContact);
            }
        }

        // Return registered contacts with phone-book name preferred
        const registeredContacts = contacts
            .filter((c) => registeredMap.has(c.phoneNumber))
            .map((c) => {
                const user = registeredMap.get(c.phoneNumber)!;
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

    /**
     * Called when a new user registers.
     * Marks all existing user_contact rows that have this phone number as registered.
     */
    async markPhoneAsRegistered(phoneNumber: string, userId: string): Promise<void> {
        await this.userContactRepository
            .createQueryBuilder()
            .update(UserContact)
            .set({ isRegistered: true, registeredUserId: userId })
            .where('phone_number = :phoneNumber AND is_registered = false', { phoneNumber })
            .execute();
    }
}
