import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { MessageType } from '../entities/message.entity';

export class CreateMessageDto {
    @ApiProperty({
        description: 'Conversation to send the message to (sender must be a participant)',
        example: '7f2c1e90-1234-4a5b-9c8d-2e3f4a5b6c7d',
    })
    @IsString()
    @IsNotEmpty()
    conversationId: string;

    @ApiPropertyOptional({
        description: 'Message text (optional for media messages)',
        example: 'Hello! Khana kha liya?',
    })
    @IsString()
    @IsOptional()
    text?: string;

    @ApiProperty({
        description: 'Message type',
        enum: MessageType,
        example: MessageType.TEXT,
    })
    @IsEnum(MessageType)
    type: MessageType;

    @ApiPropertyOptional({
        description: 'Media URL for image/video/audio messages',
        example: '/uploads/media/abc123.jpg',
    })
    @IsString()
    @IsOptional()
    mediaUrl?: string;
}
