import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
    constructor(private readonly messagesService: MessagesService) { }

    @Post()
    async create(@CurrentUser() user: any, @Body() createMessageDto: CreateMessageDto) {
        return this.messagesService.create(user.userId, createMessageDto);
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
        await this.messagesService.markAsRead(id, user.userId);
        return { success: true };
    }

    @Delete(':id')
    async delete(@CurrentUser() user: any, @Param('id') id: string) {
        await this.messagesService.delete(id, user.userId);
        return { success: true };
    }
}
