import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserContact } from './entities/user-contact.entity';
import { UserBlock } from './entities/user-block.entity';
import { S3Service } from '../s3/s3.service';

// Focused on the block/unblock logic added this session — not a full
// UsersService suite (avatar upload, contacts sync, etc. are pre-existing
// and out of scope for this pass).
describe('UsersService — blocking', () => {
    let service: UsersService;
    let userBlockRepository: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; delete: jest.Mock };

    beforeEach(async () => {
        userBlockRepository = {
            findOne: jest.fn(),
            save: jest.fn(async (b) => b),
            create: jest.fn((data) => data),
            delete: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UsersService,
                { provide: getRepositoryToken(User), useValue: {} },
                { provide: getRepositoryToken(UserContact), useValue: {} },
                { provide: getRepositoryToken(UserBlock), useValue: userBlockRepository },
                { provide: S3Service, useValue: {} },
            ],
        }).compile();

        service = module.get<UsersService>(UsersService);
    });

    describe('blockUser', () => {
        it('rejects blocking yourself', async () => {
            await expect(service.blockUser('user-1', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('creates a block row', async () => {
            userBlockRepository.findOne.mockResolvedValue(null);
            await service.blockUser('user-1', 'user-2');
            expect(userBlockRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({ blockerId: 'user-1', blockedId: 'user-2' }),
            );
        });

        it('is idempotent if already blocked', async () => {
            userBlockRepository.findOne.mockResolvedValue({ id: 'existing', blockerId: 'user-1', blockedId: 'user-2' });
            await service.blockUser('user-1', 'user-2');
            expect(userBlockRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('isBlockedEitherWay', () => {
        it('returns true if user1 blocked user2', async () => {
            userBlockRepository.findOne.mockResolvedValue({ blockerId: 'user-1', blockedId: 'user-2' });
            const result = await service.isBlockedEitherWay('user-1', 'user-2');
            expect(result).toBe(true);
        });

        it('returns true if user2 blocked user1 (reverse direction)', async () => {
            userBlockRepository.findOne.mockResolvedValue({ blockerId: 'user-2', blockedId: 'user-1' });
            const result = await service.isBlockedEitherWay('user-1', 'user-2');
            expect(result).toBe(true);

            // Confirms the query actually checks both directions, not just one
            expect(userBlockRepository.findOne).toHaveBeenCalledWith({
                where: [
                    { blockerId: 'user-1', blockedId: 'user-2' },
                    { blockerId: 'user-2', blockedId: 'user-1' },
                ],
            });
        });

        it('returns false when no block exists in either direction', async () => {
            userBlockRepository.findOne.mockResolvedValue(null);
            const result = await service.isBlockedEitherWay('user-1', 'user-2');
            expect(result).toBe(false);
        });
    });

    describe('unblockUser', () => {
        it('deletes the block row for that direction', async () => {
            await service.unblockUser('user-1', 'user-2');
            expect(userBlockRepository.delete).toHaveBeenCalledWith({ blockerId: 'user-1', blockedId: 'user-2' });
        });
    });
});
