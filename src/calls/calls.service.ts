import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, In, LessThan, MoreThan } from 'typeorm';
import * as crypto from 'crypto';
import { Call, CallStatus, CallType } from './entities/call.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { UsersService } from '../users/users.service';

/** How long a generated TURN credential stays valid before the client must ask for a new one. */
const TURN_CREDENTIAL_TTL_SECONDS = 600;

/** How long an unanswered call rings before it's auto-marked missed. */
const RING_TIMEOUT_MS = 45_000;

/** Safety net for calls stuck "ongoing" because a client never sent call_end. */
const MAX_ONGOING_MS = 4 * 60 * 60 * 1000;

/** Anti-spam/harassment cap: at most this many invites from one caller per window. */
const RATE_LIMIT_MAX_INVITES = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

@Injectable()
export class CallsService {
    constructor(
        @InjectRepository(Call)
        private callRepository: Repository<Call>,
        private conversationsService: ConversationsService,
        private usersService: UsersService,
        private configService: ConfigService,
    ) { }

    /**
     * Short-lived TURN credentials via coturn's standard shared-secret ("TURN
     * REST API") mechanism: username is "<expiryUnixTs>:<userId>", credential
     * is HMAC-SHA1(secret, username) base64-encoded — coturn validates both
     * against the same TURN_SECRET without ever storing per-user credentials.
     * Returns null if TURN isn't configured yet, so the client can fall back
     * to STUN-only rather than erroring out.
     */
    async getTurnCredentials(userId: string): Promise<{ urls: string[]; username: string; credential: string; ttl: number } | null> {
        const turnUrl = this.configService.get<string>('TURN_SERVER_URL');
        const turnSecret = this.configService.get<string>('TURN_SECRET');
        if (!turnUrl || !turnSecret) return null;

        const expiry = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
        const username = `${expiry}:${userId}`;
        const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');

        return {
            urls: [`turn:${turnUrl}?transport=udp`, `turn:${turnUrl}?transport=tcp`],
            username,
            credential,
            ttl: TURN_CREDENTIAL_TTL_SECONDS,
        };
    }

    /**
     * Starts a call. Validates both parties are actually participants of the
     * conversation, then checks for an existing active call between this pair:
     * - same direction already ringing/ongoing -> idempotent, returns it as-is
     * - reverse direction already ringing (glare) -> the call created first
     *   wins; the caller of the newer attempt is told to look at their own
     *   incoming call instead of creating a duplicate outgoing ring
     * - callee already on an unrelated active call -> busy, no row created
     */
    async initiateCall(callerId: string, conversationId: string, calleeId: string, type: CallType): Promise<Call> {
        if (callerId === calleeId) {
            throw new BadRequestException('Cannot call yourself');
        }

        const participantIds = await this.conversationsService.getParticipantUserIds(conversationId);
        if (!participantIds.includes(callerId) || !participantIds.includes(calleeId)) {
            throw new ForbiddenException('Both users must be participants of this conversation');
        }

        await this.enforceRateLimit(callerId);

        const [callee, blocked] = await Promise.all([
            this.usersService.findOne(calleeId),
            this.usersService.isBlockedEitherWay(callerId, calleeId),
        ]);
        if (!callee.isActive) {
            throw new BadRequestException('This user is no longer available');
        }
        if (blocked) {
            throw new ForbiddenException('Cannot call this user');
        }

        const existingBetweenPair = await this.callRepository
            .createQueryBuilder('call')
            .where('call.status IN (:...statuses)', { statuses: [CallStatus.RINGING, CallStatus.ONGOING] })
            .andWhere(
                '((call.callerId = :callerId AND call.calleeId = :calleeId) OR (call.callerId = :calleeId AND call.calleeId = :callerId))',
                { callerId, calleeId },
            )
            .getOne();

        if (existingBetweenPair) {
            if (existingBetweenPair.callerId === callerId) {
                // Duplicate invite from the same caller (double-tap / retry) — idempotent.
                return existingBetweenPair;
            }
            // Glare: the callee already invited this caller moments ago. First one created wins.
            throw new ConflictException({ reason: 'GLARE_EXISTING_CALL', existingCall: existingBetweenPair });
        }

        const calleeBusy = await this.callRepository.findOne({
            where: [
                { callerId: calleeId, status: In([CallStatus.RINGING, CallStatus.ONGOING]) },
                { calleeId, status: In([CallStatus.RINGING, CallStatus.ONGOING]) },
            ],
        });
        if (calleeBusy) {
            throw new ConflictException({ reason: 'BUSY' });
        }

        const call = this.callRepository.create({
            conversationId,
            callerId,
            calleeId,
            type,
            status: CallStatus.RINGING,
        });
        return this.callRepository.save(call);
    }

    /** Only the callee may accept, only while still ringing and not expired. Idempotent on retry. */
    async acceptCall(callId: string, userId: string): Promise<Call> {
        const call = await this.getCallOrThrow(callId);

        if (userId !== call.calleeId) {
            throw new ForbiddenException('Only the callee can accept this call');
        }

        if (call.status === CallStatus.ONGOING) {
            // Double-tap accept / resent after socket reconnect — no-op.
            return call;
        }

        if (call.status !== CallStatus.RINGING) {
            throw new BadRequestException(`Call is no longer available (status: ${call.status})`);
        }

        if (Date.now() - call.createdAt.getTime() > RING_TIMEOUT_MS) {
            call.status = CallStatus.MISSED;
            await this.callRepository.save(call);
            throw new BadRequestException('Call expired');
        }

        // startedAt is deliberately NOT set here — accepting means the call
        // rang and was answered, not that media is flowing yet. It's set by
        // markConnected() once the client's ICE connection actually succeeds,
        // so duration reflects real connected time, not ring-to-accept time.
        call.status = CallStatus.ONGOING;
        return this.callRepository.save(call);
    }

    /**
     * Reported by whichever client's ICE connection reaches "connected" first
     * — idempotent, only the first report sets startedAt.
     */
    async markConnected(callId: string, userId: string): Promise<Call> {
        const call = await this.getCallOrThrow(callId);
        if (userId !== call.callerId && userId !== call.calleeId) {
            throw new ForbiddenException('Not a participant of this call');
        }
        if (call.status === CallStatus.ONGOING && !call.startedAt) {
            call.startedAt = new Date();
            await this.callRepository.save(call);
        }
        return call;
    }

    async rejectCall(callId: string, userId: string): Promise<Call> {
        const call = await this.getCallOrThrow(callId);

        if (userId !== call.calleeId) {
            throw new ForbiddenException('Only the callee can reject this call');
        }

        if (call.status !== CallStatus.RINGING) {
            return call; // already resolved — idempotent
        }

        call.status = CallStatus.REJECTED;
        return this.callRepository.save(call);
    }

    async cancelCall(callId: string, userId: string): Promise<Call> {
        const call = await this.getCallOrThrow(callId);

        if (userId !== call.callerId) {
            throw new ForbiddenException('Only the caller can cancel this call');
        }

        if (call.status !== CallStatus.RINGING) {
            return call; // already answered/resolved — idempotent
        }

        call.status = CallStatus.CANCELLED;
        return this.callRepository.save(call);
    }

    /** Either party can end. Ends an ongoing call with a duration, or cancels one still ringing. */
    async endCall(callId: string, userId: string): Promise<Call> {
        const call = await this.getCallOrThrow(callId);

        if (userId !== call.callerId && userId !== call.calleeId) {
            throw new ForbiddenException('Not a participant of this call');
        }

        if (call.status === CallStatus.ONGOING) {
            call.status = CallStatus.ENDED;
            call.endedAt = new Date();
            call.durationSeconds = this.computeDuration(call.startedAt, call.endedAt);
            return this.callRepository.save(call);
        }

        if (call.status === CallStatus.RINGING) {
            call.status = CallStatus.CANCELLED;
            return this.callRepository.save(call);
        }

        return call; // already terminal — idempotent
    }

    /** Same pattern as OTP rate-limiting: count recent rows, reject once past the cap. */
    private async enforceRateLimit(callerId: string): Promise<void> {
        const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
        const recentInvites = await this.callRepository.count({
            where: { callerId, createdAt: MoreThan(windowStart) },
        });
        if (recentInvites >= RATE_LIMIT_MAX_INVITES) {
            throw new BadRequestException('Too many call attempts. Please try again in a moment.');
        }
    }

    /** startedAt (media-connected time) can legitimately be null if a call never got past ringing/accepted. */
    private computeDuration(startedAt: Date | null, endedAt: Date): number {
        if (!startedAt) return 0;
        return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
    }

    async getCallOrThrow(callId: string): Promise<Call> {
        const call = await this.callRepository.findOne({ where: { id: callId } });
        if (!call) {
            throw new NotFoundException('Call not found');
        }
        return call;
    }

    /**
     * The initial call_ringing emit fires once, at invite time — if the
     * callee's socket wasn't connected yet (backgrounded/killed), it goes
     * nowhere and is never repeated. Called when a socket (re)connects so
     * the gateway can replay it, the same way deliverPendingMessages
     * resyncs missed messages on reconnect.
     */
    async findActiveRingingCallForCallee(calleeId: string): Promise<Call | null> {
        return this.callRepository.findOne({
            where: { calleeId, status: CallStatus.RINGING },
            order: { createdAt: 'DESC' },
        });
    }

    /** Accumulates client-reported connection health for basic ICE/TURN observability. */
    async reportStats(
        callId: string,
        userId: string,
        stats: { iceFailure?: boolean; reconnect?: boolean; finalIceState?: string },
    ): Promise<void> {
        const call = await this.getCallOrThrow(callId);
        if (userId !== call.callerId && userId !== call.calleeId) {
            throw new ForbiddenException('Not a participant of this call');
        }

        if (stats.iceFailure) call.iceFailures += 1;
        if (stats.reconnect) call.reconnectCount += 1;
        if (stats.finalIceState) call.finalIceState = stats.finalIceState;

        await this.callRepository.save(call);
    }

    /**
     * Answer/miss rate and connection-health summary for the current user's
     * calls — the "basic call analytics" / "basic ICE/TURN health" cases.
     * No admin panel in this app, so this is scoped to the requesting user
     * rather than being a global aggregate.
     */
    async getAnalytics(userId: string): Promise<{
        totalCalls: number;
        answeredCount: number;
        missedCount: number;
        rejectedCount: number;
        cancelledCount: number;
        answerRate: number;
        missRate: number;
        avgConnectionSeconds: number;
        avgIceFailures: number;
        avgReconnectCount: number;
    }> {
        const calls = await this.callRepository.find({
            where: [{ callerId: userId }, { calleeId: userId }],
        });

        const totalCalls = calls.length;
        const answered = calls.filter((c) => c.status === CallStatus.ENDED);
        const missed = calls.filter((c) => c.status === CallStatus.MISSED);
        const rejected = calls.filter((c) => c.status === CallStatus.REJECTED);
        const cancelled = calls.filter((c) => c.status === CallStatus.CANCELLED);

        const avg = (nums: number[]) => (nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length);

        return {
            totalCalls,
            answeredCount: answered.length,
            missedCount: missed.length,
            rejectedCount: rejected.length,
            cancelledCount: cancelled.length,
            answerRate: totalCalls === 0 ? 0 : answered.length / totalCalls,
            missRate: totalCalls === 0 ? 0 : missed.length / totalCalls,
            avgConnectionSeconds: avg(answered.map((c) => c.durationSeconds ?? 0)),
            avgIceFailures: avg(calls.map((c) => c.iceFailures)),
            avgReconnectCount: avg(calls.map((c) => c.reconnectCount)),
        };
    }

    /** Global call log for the Calls tab — every call this user was party to, across all conversations. */
    async getMyCallHistory(userId: string, page = 1, limit = 30): Promise<{ calls: Call[]; total: number }> {
        const [calls, total] = await this.callRepository.findAndCount({
            where: [{ callerId: userId }, { calleeId: userId }],
            relations: ['caller', 'callee'],
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });
        return { calls, total };
    }

    async getHistory(conversationId: string, userId: string, page = 1, limit = 30): Promise<{ calls: Call[]; total: number }> {
        const participantIds = await this.conversationsService.getParticipantUserIds(conversationId);
        if (!participantIds.includes(userId)) {
            throw new ForbiddenException('You are not a participant of this conversation');
        }

        const [calls, total] = await this.callRepository.findAndCount({
            where: { conversationId },
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });
        return { calls, total };
    }

    /**
     * Periodic sweep run by the gateway: closes calls that rang too long
     * without an answer. Covers both "callee never responded" and "caller
     * disconnected while ringing" (the disconnect handler cancels the
     * caller-side case immediately; this is the general-purpose fallback net).
     */
    async sweepExpiredRingingCalls(): Promise<Call[]> {
        const cutoff = new Date(Date.now() - RING_TIMEOUT_MS);
        const expired = await this.callRepository.find({
            where: { status: CallStatus.RINGING, createdAt: LessThan(cutoff) },
        });
        if (expired.length === 0) return [];

        for (const call of expired) {
            call.status = CallStatus.MISSED;
        }
        await this.callRepository.save(expired);
        return expired;
    }

    /**
     * Zombie-call recovery: a call stuck "ongoing" for hours means the server
     * (or both clients) never got a call_end — force-close it rather than
     * leaving a permanently wrong row.
     */
    async sweepStaleOngoingCalls(): Promise<Call[]> {
        const cutoff = new Date(Date.now() - MAX_ONGOING_MS);
        // Two ways a call can be stuck "ongoing": media connected ages ago and
        // just never got a call_end, OR it was accepted but startedAt never
        // got set at all (media never actually connected) — startedAt stays
        // NULL forever in that case, so it needs its own branch here or it'd
        // silently dodge this sweep and leak as a permanent zombie row.
        const stale = await this.callRepository
            .createQueryBuilder('call')
            .where('call.status = :status', { status: CallStatus.ONGOING })
            .andWhere('(call.startedAt < :cutoff OR (call.startedAt IS NULL AND call.createdAt < :cutoff))', { cutoff })
            .getMany();
        if (stale.length === 0) return [];

        for (const call of stale) {
            call.status = CallStatus.ENDED;
            call.endedAt = new Date();
            call.durationSeconds = this.computeDuration(call.startedAt, call.endedAt);
        }
        await this.callRepository.save(stale);
        return stale;
    }

    /**
     * Called on socket disconnect. Only the caller-while-ringing case is
     * resolved immediately (nobody has answered yet, so there's no live media
     * to protect) — cancelled calls notify the callee right away instead of
     * waiting out the full ring timeout. Ongoing calls are deliberately left
     * alone here: a dropped socket doesn't mean dropped media (WebRTC can
     * survive on ICE alone), so ending them belongs to call_end or the
     * stale-ongoing sweep, not a disconnect reaction.
     */
    async handleUserDisconnect(userId: string): Promise<Call[]> {
        const ringingAsCaller = await this.callRepository.find({
            where: { callerId: userId, status: CallStatus.RINGING },
        });
        if (ringingAsCaller.length === 0) return [];

        for (const call of ringingAsCaller) {
            call.status = CallStatus.CANCELLED;
        }
        await this.callRepository.save(ringingAsCaller);
        return ringingAsCaller;
    }

    /**
     * Called on logout — unlike a disconnect (which might just be a network
     * blip), a logout is a deliberate sign-out, so any call this user is
     * still ringing OR actively on gets terminated outright.
     */
    async endActiveCallsForUser(userId: string): Promise<Call[]> {
        const activeCalls = await this.callRepository.find({
            where: [
                { callerId: userId, status: In([CallStatus.RINGING, CallStatus.ONGOING]) },
                { calleeId: userId, status: In([CallStatus.RINGING, CallStatus.ONGOING]) },
            ],
        });
        if (activeCalls.length === 0) return [];

        for (const call of activeCalls) {
            if (call.status === CallStatus.ONGOING) {
                call.status = CallStatus.ENDED;
                call.endedAt = new Date();
                call.durationSeconds = this.computeDuration(call.startedAt, call.endedAt);
            } else {
                call.status = CallStatus.CANCELLED;
            }
        }
        await this.callRepository.save(activeCalls);
        return activeCalls;
    }
}
