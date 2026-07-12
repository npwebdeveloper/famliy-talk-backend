import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, ParseIntPipe, Inject, forwardRef } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatGateway } from '../websocket/chat.gateway';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
    constructor(
        private readonly messagesService: MessagesService,
        @Inject(forwardRef(() => ChatGateway))
        private readonly chatGateway: ChatGateway,
    ) { }

    @Post()
    async create(@CurrentUser() user: any, @Body() createMessageDto: CreateMessageDto) {
        const message = await this.messagesService.create(user.userId, createMessageDto);

        // REST-sent messages must reach online recipients in real-time too,
        // same as socket-sent ones (room + direct to participants outside it)
        await this.chatGateway.notifyNewMessage(message, user.userId);

        return message;
    }

    @Get('conversation/:conversationId')
    async findByConversation(
        @CurrentUser() user: any,
        @Param('conversationId') conversationId: string,
        @Query('page', ParseIntPipe) page: number = 1,
        @Query('limit', ParseIntPipe) limit: number = 50,
    ) {
        return this.messagesService.findByConversation(conversationId, user.userId, page, limit);
    }

    @Post(':id/read')
    async markAsRead(@CurrentUser() user: any, @Param('id') id: string) {
        const result = await this.messagesService.markAsRead(id, user.userId);

        // Same real-time receipt as the socket path — sender's tick turns blue
        // no matter which transport the reader used
        if (result) {
            this.chatGateway.notifyStatusChange('message_read', {
                messageId: id,
                conversationId: result.conversationId,
                userId: user.userId,
            }, result.senderId);
        }

        return { success: true };
    }

    @Delete(':id')
    async delete(@CurrentUser() user: any, @Param('id') id: string) {
        await this.messagesService.delete(id, user.userId);
        return { success: true };
    }
}
