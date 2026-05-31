import { Controller, Get, Put, Post, Body, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get('me')
    async getMe(@CurrentUser() user: any) {
        return this.usersService.findOne(user.userId);
    }

    @Put('profile')
    async updateProfile(
        @CurrentUser() user: any,
        @Body() updateProfileDto: UpdateProfileDto,
    ) {
        return this.usersService.updateProfile(user.userId, updateProfileDto);
    }

    @Post('avatar')
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
    async searchUsers(@Query('query') query: string) {
        if (!query || query.length < 2) {
            throw new BadRequestException('Query must be at least 2 characters');
        }
        return this.usersService.searchUsers(query);
    }

    @Put('status')
    async updateStatus(
        @CurrentUser() user: any,
        @Body('isOnline') isOnline: boolean,
    ) {
        await this.usersService.updateOnlineStatus(user.userId, isOnline);
        return { success: true };
    }
}
