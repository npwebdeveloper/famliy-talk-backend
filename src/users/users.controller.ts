import { Controller, Get, Put, Post, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SyncContactsDto } from './dto/sync-contacts.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get('me')
    @ApiOperation({ summary: "Get current user's full profile" })
    @ApiResponse({ status: 200, description: 'User profile from database' })
    @ApiResponse({ status: 404, description: 'User not found' })
    async getMe(@CurrentUser() user: any) {
        return this.usersService.findOne(user.userId);
    }

    @Put('profile')
    @ApiOperation({ summary: 'Update name and bio' })
    @ApiResponse({ status: 200, description: 'Updated user profile' })
    async updateProfile(
        @CurrentUser() user: any,
        @Body() updateProfileDto: UpdateProfileDto,
    ) {
        return this.usersService.updateProfile(user.userId, updateProfileDto);
    }

    @Post('avatar')
    @ApiOperation({
        summary: 'Upload avatar image (jpg/jpeg/png/gif, max 5MB)',
        description: 'Resized to 512x512 and stored in S3 (private bucket). Response contains a presigned URL, valid for a few days — re-fetch user data periodically rather than caching it indefinitely.',
    })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', description: 'Image file' },
            },
            required: ['file'],
        },
    })
    @ApiResponse({ status: 201, description: '{ avatarUrl } — presigned S3 URL' })
    @ApiResponse({ status: 400, description: 'No file / not an image / too large' })
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: {
                fileSize: 5 * 1024 * 1024, // 5MB
            },
            fileFilter: (req, file, cb) => {
                if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
                    return cb(new BadRequestException('Only image files are allowed'), false);
                }
                cb(null, true);
            },
        }),
    )
    async uploadAvatar(
        @CurrentUser() user: any,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        const updatedUser = await this.usersService.updateAvatar(user.userId, file.buffer);

        return {
            avatarUrl: updatedUser.avatarUrl,
        };
    }

    @Get('contacts')
    @ApiOperation({
        summary: 'Get previously-synced registered contacts',
        description: 'Returns contacts from the last sync-contacts call that are registered on Family Talk, read straight from the database — no device phonebook re-read or permission required. Used to restore contact names immediately after a fresh install/login, ahead of the next full on-device resync.',
    })
    @ApiResponse({ status: 200, description: 'Array of registered contacts (same shape as sync-contacts registeredContacts)' })
    async getContacts(@CurrentUser() user: any) {
        return this.usersService.getRegisteredContacts(user.userId);
    }

    @Get('search')
    @ApiOperation({ summary: 'Search users by name or phone number' })
    @ApiQuery({ name: 'query', description: 'Search text (min 2 characters)', example: 'radhe' })
    @ApiResponse({ status: 200, description: 'Matching users (max 20)' })
    @ApiResponse({ status: 400, description: 'Query shorter than 2 characters' })
    async searchUsers(@Query('query') query: string) {
        if (!query || query.length < 2) {
            throw new BadRequestException('Query must be at least 2 characters');
        }
        return this.usersService.searchUsers(query);
    }

    @Put('status')
    @ApiOperation({ summary: 'Manually set online/offline status' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: { isOnline: { type: 'boolean', example: true } },
            required: ['isOnline'],
        },
    })
    @ApiResponse({ status: 200, description: '{ success: true }' })
    async updateStatus(
        @CurrentUser() user: any,
        @Body('isOnline') isOnline: boolean,
    ) {
        await this.usersService.updateOnlineStatus(user.userId, isOnline);
        return { success: true };
    }

    @Post('fcm-token')
    @ApiOperation({
        summary: 'Register device FCM token for push notifications',
        description: 'One token per user — logging in on a new device replaces the old token. Cleared automatically on logout.',
    })
    @ApiResponse({ status: 201, description: '{ success: true }' })
    async updateFcmToken(
        @CurrentUser() user: any,
        @Body() updateFcmTokenDto: UpdateFcmTokenDto,
    ) {
        await this.usersService.updateFcmToken(user.userId, updateFcmTokenDto.fcmToken);
        return { success: true };
    }

    @Post('sync-contacts')
    @ApiOperation({
        summary: 'Sync phone book contacts',
        description: 'Bulk upserts the contact list and returns only the contacts registered on Family Talk (with their profile info, phone-book name preferred).',
    })
    @ApiResponse({ status: 201, description: '{ registeredContacts: [...] }' })
    async syncContacts(
        @CurrentUser() user: any,
        @Body() syncContactsDto: SyncContactsDto,
    ) {
        return this.usersService.syncContacts(user.userId, syncContactsDto.contacts);
    }

    @Post('block/:userId')
    @ApiOperation({ summary: 'Block a user (also prevents calls between the two of you)' })
    @ApiResponse({ status: 201, description: '{ success: true }' })
    async blockUser(@CurrentUser() user: any, @Param('userId') userId: string) {
        await this.usersService.blockUser(user.userId, userId);
        return { success: true };
    }

    @Delete('block/:userId')
    @ApiOperation({ summary: 'Unblock a user' })
    @ApiResponse({ status: 200, description: '{ success: true }' })
    async unblockUser(@CurrentUser() user: any, @Param('userId') userId: string) {
        await this.usersService.unblockUser(user.userId, userId);
        return { success: true };
    }
}
