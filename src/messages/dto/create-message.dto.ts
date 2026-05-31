import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { MessageType } from '../entities/message.entity';

export class CreateMessageDto {
    @IsString()
    @IsNotEmpty()
    conversationId: string;

    @IsString()
    @IsOptional()
    text?: string;

    @IsEnum(MessageType)
    type: MessageType;

    @IsString()
    @IsOptional()
    mediaUrl?: string;
}
