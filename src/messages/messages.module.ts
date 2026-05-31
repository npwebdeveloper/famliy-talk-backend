import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { Message } from './entities/message.entity';
import { MessageStatus } from './entities/message-status.entity';
import { ConversationParticipant } from '../conversations/entities/conversation-participant.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Message, MessageStatus, ConversationParticipant])],
    controllers: [MessagesController],
    providers: [MessagesService],
    exports: [MessagesService],
})
export class MessagesModule { }
