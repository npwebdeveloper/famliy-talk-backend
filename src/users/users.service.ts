import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,
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
}
