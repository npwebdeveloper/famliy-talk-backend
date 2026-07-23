import { Controller, Get, Post, Param, Query, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Calls')
@ApiBearerAuth('JWT-auth')
@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
    constructor(private readonly callsService: CallsService) { }

    @Get('conversation/:conversationId')
    @ApiOperation({ summary: 'Get call history for a conversation (paginated, newest first)' })
    @ApiParam({ name: 'conversationId', description: 'Conversation ID (UUID)' })
    @ApiQuery({ name: 'page', required: false, example: 1 })
    @ApiQuery({ name: 'limit', required: false, example: 30 })
    @ApiResponse({ status: 200, description: '{ calls, total }' })
    @ApiResponse({ status: 403, description: 'Not a participant of this conversation' })
    async findByConversation(
        @CurrentUser() user: any,
        @Param('conversationId') conversationId: string,
        @Query('page', ParseIntPipe) page: number = 1,
        @Query('limit', ParseIntPipe) limit: number = 30,
    ) {
        return this.callsService.getHistory(conversationId, user.userId, page, limit);
    }

    @Get('turn-credentials')
    @ApiOperation({
        summary: 'Get short-lived TURN server credentials',
        description: 'Time-limited (10 min) username/credential pair for the WebRTC relay fallback, generated via the coturn shared-secret mechanism. Returns null if TURN_SERVER_URL/TURN_SECRET are not configured — client should fall back to STUN-only in that case.',
    })
    @ApiResponse({ status: 200, description: '{ urls, username, credential, ttl } | null' })
    async getTurnCredentials(@CurrentUser() user: any) {
        return this.callsService.getTurnCredentials(user.userId);
    }

    // IMPORTANT: keep this below any literal-path GET routes above (e.g.
    // turn-credentials) — as a single dynamic segment it would otherwise
    // swallow them.
    @Get(':id')
    @ApiOperation({ summary: 'Get a single call by id' })
    @ApiParam({ name: 'id', description: 'Call ID (UUID)' })
    @ApiResponse({ status: 200, description: 'Call record' })
    @ApiResponse({ status: 404, description: 'Call not found' })
    async findOne(@Param('id') id: string) {
        return this.callsService.getCallOrThrow(id);
    }

    @Post(':id/report-stats')
    @ApiOperation({
        summary: 'Report client-side connection health for a call',
        description: 'Fire-and-forget from the client on ICE failures/reconnects and once more with the final ICE state when the call ends — powers basic connection-quality analytics.',
    })
    @ApiParam({ name: 'id', description: 'Call ID (UUID)' })
    @ApiResponse({ status: 201, description: '{ success: true }' })
    async reportStats(
        @CurrentUser() user: any,
        @Param('id') id: string,
        @Body() body: { iceFailure?: boolean; reconnect?: boolean; finalIceState?: string },
    ) {
        await this.callsService.reportStats(id, user.userId, body);
        return { success: true };
    }

    @Get('analytics/me')
    @ApiOperation({ summary: "Answer/miss rate and connection-health summary for the current user's calls" })
    @ApiResponse({ status: 200, description: 'Analytics summary' })
    async getMyAnalytics(@CurrentUser() user: any) {
        return this.callsService.getAnalytics(user.userId);
    }
}
