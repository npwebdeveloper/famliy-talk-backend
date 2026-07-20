import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateFcmTokenDto {
    @ApiProperty({
        description: 'FCM device token for push notifications (one per user, last device wins)',
        example: 'dQw4w9WgXcQ:APA91bF...',
    })
    @IsString()
    @IsNotEmpty()
    fcmToken: string;
}
