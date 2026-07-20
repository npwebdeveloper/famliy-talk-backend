import { Controller, Get, Put, Post, Body, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';
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
    @ApiOperation({ summary: 'Upload avatar image (jpg/jpeg/png/gif, max 5MB)' })
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
    @ApiResponse({ status: 201, description: '{ avatarUrl } — served under /uploads/avatars/' })
    @ApiResponse({ status: 400, description: 'No file / not an image / too large' })
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: './uploads/avatars',
                filename: (req, file, cb) => {
                    const randomName = Array(32)
                        .fill(null)
                        .map(() => Math.round(Math.random() * 16).toString(16))
                        .join('');
                    cb(null, `${randomName}${extname(file.originalname)}`);
                },
            }),
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

        const avatarUrl = `/uploads/avatars/${file.filename}`;
        const updatedUser = await this.usersService.updateAvatar(user.userId, avatarUrl);

        return {
            avatarUrl: updatedUser.avatarUrl,
        };
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
}
