import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Conversations')
@ApiBearerAuth('JWT-auth')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
    constructor(private readonly conversationsService: ConversationsService) { }

    @Post()
    @ApiOperation({
        summary: 'Create a conversation',
        description: 'For 2 participants an existing private conversation is returned instead of creating a duplicate. 3+ participants creates a group.',
    })
    @ApiResponse({ status: 201, description: 'Conversation (new or existing) with participants' })
    async create(
        @CurrentUser() user: any,
        @Body() createConversationDto: CreateConversationDto,
    ) {
        return this.conversationsService.create(user.userId, createConversationDto);
    }

    @Get()
    @ApiOperation({ summary: "List current user's conversations (paginated)" })
    @ApiQuery({ name: 'page', required: false, example: 1 })
    @ApiQuery({ name: 'limit', required: false, example: 20 })
    @ApiResponse({
        status: 200,
        description: '{ conversations, total } — ordered by most recent activity; each conversation includes participants, lastMessage (single message, or null), and unreadCount',
    })
    async findAll(
        @CurrentUser() user: any,
        @Query('page', ParseIntPipe) page: number = 1,
        @Query('limit', ParseIntPipe) limit: number = 20,
    ) {
        return this.conversationsService.findAll(user.userId, page, limit);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a single conversation (must be a participant)' })
    @ApiParam({ name: 'id', description: 'Conversation ID (UUID)' })
    @ApiResponse({ status: 200, description: 'Conversation with participants and messages' })
    @ApiResponse({ status: 403, description: 'Not a participant of this conversation' })
    @ApiResponse({ status: 404, description: 'Conversation not found' })
    async findOne(@CurrentUser() user: any, @Param('id') id: string) {
        return this.conversationsService.findOne(id, user.userId);
    }

    @Put(':id/read')
    @ApiOperation({
        summary: 'Mark conversation as read',
        description: "Updates the participant's lastReadAt — clears the unread badge in the chat list.",
    })
    @ApiParam({ name: 'id', description: 'Conversation ID (UUID)' })
    @ApiResponse({ status: 200, description: '{ success: true }' })
    @ApiResponse({ status: 404, description: 'Participant not found' })
    async markAsRead(@CurrentUser() user: any, @Param('id') id: string) {
        await this.conversationsService.markAsRead(id, user.userId);
        return { success: true };
    }
}
