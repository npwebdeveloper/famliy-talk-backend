import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { Conversation } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { Message } from '../messages/entities/message.entity';
import { MessageStatus } from '../messages/entities/message-status.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Conversation, ConversationParticipant, Message, MessageStatus])],
    controllers: [ConversationsController],
    providers: [ConversationsService],
    exports: [ConversationsService],
})
export class ConversationsModule { }
