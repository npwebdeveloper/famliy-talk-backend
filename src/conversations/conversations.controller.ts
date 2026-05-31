import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
    constructor(private readonly conversationsService: ConversationsService) { }

    @Post()
    async create(
        @CurrentUser() user: any,
        @Body() createConversationDto: CreateConversationDto,
    ) {
        return this.conversationsService.create(user.userId, createConversationDto);
    }

    @Get()
    async findAll(
        @CurrentUser() user: any,
        @Query('page', ParseIntPipe) page: number = 1,
        @Query('limit', ParseIntPipe) limit: number = 20,
    ) {
        return this.conversationsService.findAll(user.userId, page, limit);
    }

    @Get(':id')
    async findOne(@CurrentUser() user: any, @Param('id') id: string) {
        return this.conversationsService.findOne(id, user.userId);
    }

    @Put(':id/read')
    async markAsRead(@CurrentUser() user: any, @Param('id') id: string) {
        await this.conversationsService.markAsRead(id, user.userId);
        return { success: true };
    }
}
