import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe, Inject, forwardRef } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatGateway } from '../websocket/chat.gateway';

@ApiTags('Messages')
@ApiBearerAuth('JWT-auth')
@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
    constructor(
        private readonly messagesService: MessagesService,
        @Inject(forwardRef(() => ChatGateway))
        private readonly chatGateway: ChatGateway,
    ) { }

    @Post()
    @ApiOperation({
        summary: 'Send a message',
        description: 'Creates the message, emits new_message to the conversation room (same as the socket path), and push-notifies offline recipients via FCM.',
    })
    @ApiResponse({ status: 201, description: 'Saved message with sender and per-recipient statuses' })
    @ApiResponse({ status: 403, description: 'Not a participant of this conversation' })
    async create(@CurrentUser() user: any, @Body() createMessageDto: CreateMessageDto) {
        const message = await this.messagesService.create(user.userId, createMessageDto);

        // REST-sent messages must reach online recipients in real-time too,
        // same as socket-sent ones (room + direct to participants outside it)
        await this.chatGateway.notifyNewMessage(message, user.userId);

        return message;
    }

    @Get('conversation/:conversationId')
    @ApiOperation({ summary: 'Get messages in a conversation (paginated, oldest first)' })
    @ApiParam({ name: 'conversationId', description: 'Conversation ID (UUID)' })
    @ApiQuery({ name: 'page', required: false, example: 1 })
    @ApiQuery({ name: 'limit', required: false, example: 50 })
    @ApiResponse({ status: 200, description: '{ messages, total } — each message includes sender and statuses' })
    @ApiResponse({ status: 403, description: 'Not a participant of this conversation' })
    async findByConversation(
        @CurrentUser() user: any,
        @Param('conversationId') conversationId: string,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    ) {
        return this.messagesService.findByConversation(conversationId, user.userId, page, limit);
    }

    @Post(':id/read')
    @ApiOperation({
        summary: 'Mark a message as read',
        description: "Updates the reader's message_status to read (backfills deliveredAt) and emits message_read to the sender in real-time — same behavior as the socket path.",
    })
    @ApiParam({ name: 'id', description: 'Message ID (UUID)' })
    @ApiResponse({ status: 201, description: '{ success: true }' })
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
    @ApiOperation({ summary: 'Delete own message' })
    @ApiParam({ name: 'id', description: 'Message ID (UUID)' })
    @ApiResponse({ status: 200, description: '{ success: true }' })
    @ApiResponse({ status: 403, description: 'Can only delete your own messages' })
    @ApiResponse({ status: 404, description: 'Message not found' })
    async delete(@CurrentUser() user: any, @Param('id') id: string) {
        await this.messagesService.delete(id, user.userId);
        return { success: true };
    }
}
