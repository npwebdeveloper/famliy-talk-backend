import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import * as crypto from 'crypto';
import { CallsService } from './calls.service';
import { Call, CallStatus, CallType } from './entities/call.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { UsersService } from '../users/users.service';

const CALLER_ID = 'caller-1';
const CALLEE_ID = 'callee-1';
const CONVERSATION_ID = 'conv-1';
const CALL_ID = 'call-1';

const makeCall = (overrides: Partial<Call> = {}): Call => {
    const call = new Call();
    call.id = CALL_ID;
    call.conversationId = CONVERSATION_ID;
    call.callerId = CALLER_ID;
    call.calleeId = CALLEE_ID;
    call.type = CallType.VIDEO;
    call.status = CallStatus.RINGING;
    call.startedAt = null;
    call.endedAt = null;
    call.durationSeconds = null;
    call.iceFailures = 0;
    call.reconnectCount = 0;
    call.finalIceState = null;
    call.createdAt = new Date();
    return Object.assign(call, overrides);
};

describe('CallsService', () => {
    let service: CallsService;
    let callRepository: {
        create: jest.Mock;
        save: jest.Mock;
        findOne: jest.Mock;
        find: jest.Mock;
        findAndCount: jest.Mock;
        count: jest.Mock;
        createQueryBuilder: jest.Mock;
    };
    let conversationsService: { getParticipantUserIds: jest.Mock };
    let usersService: { findOne: jest.Mock; isBlockedEitherWay: jest.Mock };
    let configService: { get: jest.Mock };

    // Reusable chainable query-builder mock (used by initiateCall's glare
    // check and sweepStaleOngoingCalls).
    let queryBuilder: { where: jest.Mock; andWhere: jest.Mock; getOne: jest.Mock; getMany: jest.Mock };

    beforeEach(async () => {
        queryBuilder = {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getOne: jest.fn(),
            getMany: jest.fn(),
        };

        callRepository = {
            create: jest.fn((data) => makeCall(data)),
            save: jest.fn(async (call) => call),
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn(() => queryBuilder),
        };

        conversationsService = {
            getParticipantUserIds: jest.fn().mockResolvedValue([CALLER_ID, CALLEE_ID]),
        };

        usersService = {
            findOne: jest.fn().mockResolvedValue({ id: CALLEE_ID, isActive: true }),
            isBlockedEitherWay: jest.fn().mockResolvedValue(false),
        };

        configService = { get: jest.fn().mockReturnValue(undefined) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CallsService,
                { provide: getRepositoryToken(Call), useValue: callRepository },
                { provide: ConversationsService, useValue: conversationsService },
                { provide: UsersService, useValue: usersService },
                { provide: ConfigService, useValue: configService },
            ],
        }).compile();

        service = module.get<CallsService>(CallsService);

        // initiateCall always checks the rate limit first — default to "not limited"
        callRepository.count.mockResolvedValue(0);
    });

    describe('initiateCall', () => {
        it('rejects calling yourself', async () => {
            await expect(service.initiateCall(CALLER_ID, CONVERSATION_ID, CALLER_ID, CallType.VIDEO))
                .rejects.toThrow(BadRequestException);
        });

        it('rejects if either user is not a participant of the conversation', async () => {
            conversationsService.getParticipantUserIds.mockResolvedValue([CALLER_ID]); // callee missing
            await expect(service.initiateCall(CALLER_ID, CONVERSATION_ID, CALLEE_ID, CallType.VIDEO))
                .rejects.toThrow(ForbiddenException);
        });

        it('rejects once the rate limit is exceeded', async () => {
            callRepository.count.mockResolvedValue(10);
            await expect(service.initiateCall(CALLER_ID, CONVERSATION_ID, CALLEE_ID, CallType.VIDEO))
                .rejects.toThrow(BadRequestException);
        });

        it('rejects calling a deactivated user', async () => {
            usersService.findOne.mockResolvedValue({ id: CALLEE_ID, isActive: false });
            queryBuilder.getOne.mockResolvedValue(null);
            await expect(service.initiateCall(CALLER_ID, CONVERSATION_ID, CALLEE_ID, CallType.VIDEO))
                .rejects.toThrow(BadRequestException);
        });

        it('rejects calling a user who blocked (or is blocked by) the caller', async () => {
            usersService.isBlockedEitherWay.mockResolvedValue(true);
            await expect(service.initiateCall(CALLER_ID, CONVERSATION_ID, CALLEE_ID, CallType.VIDEO))
                .rejects.toThrow(ForbiddenException);
        });

        it('is idempotent on a duplicate invite from the same caller', async () => {
            const existing = makeCall({ callerId: CALLER_ID, calleeId: CALLEE_ID, status: CallStatus.RINGING });
            queryBuilder.getOne.mockResolvedValue(existing);

            const result = await service.initiateCall(CALLER_ID, CONVERSATION_ID, CALLEE_ID, CallType.VIDEO);

            expect(result).toBe(existing);
            expect(callRepository.create).not.toHaveBeenCalled();
        });

        it('treats a reverse-direction active call as glare and lets the first one win', async () => {
            const existing = makeCall({ callerId: CALLEE_ID, calleeId: CALLER_ID, status: CallStatus.RINGING });
            queryBuilder.getOne.mockResolvedValue(existing);

            await expect(service.initiateCall(CALLER_ID, CONVERSATION_ID, CALLEE_ID, CallType.VIDEO))
                .rejects.toMatchObject({
                    response: { reason: 'GLARE_EXISTING_CALL' },
                });
        });

        it('rejects with BUSY if the callee is active on an unrelated call', async () => {
            queryBuilder.getOne.mockResolvedValue(null); // no call between this pair
            callRepository.findOne.mockResolvedValue(makeCall({ callerId: CALLEE_ID, calleeId: 'someone-else' }));

            await expect(service.initiateCall(CALLER_ID, CONVERSATION_ID, CALLEE_ID, CallType.VIDEO))
                .rejects.toMatchObject({ response: { reason: 'BUSY' } });
        });

        it('creates a new RINGING call on the happy path', async () => {
            queryBuilder.getOne.mockResolvedValue(null);
            callRepository.findOne.mockResolvedValue(null); // callee not busy

            const result = await service.initiateCall(CALLER_ID, CONVERSATION_ID, CALLEE_ID, CallType.AUDIO);

            expect(callRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    conversationId: CONVERSATION_ID,
                    callerId: CALLER_ID,
                    calleeId: CALLEE_ID,
                    type: CallType.AUDIO,
                    status: CallStatus.RINGING,
                }),
            );
            expect(result.status).toBe(CallStatus.RINGING);
        });
    });

    describe('acceptCall', () => {
        it('throws if the call does not exist', async () => {
            callRepository.findOne.mockResolvedValue(null);
            await expect(service.acceptCall(CALL_ID, CALLEE_ID)).rejects.toThrow(NotFoundException);
        });

        it('only the callee may accept', async () => {
            callRepository.findOne.mockResolvedValue(makeCall());
            await expect(service.acceptCall(CALL_ID, CALLER_ID)).rejects.toThrow(ForbiddenException);
        });

        it('is idempotent when already ONGOING (double-tap accept)', async () => {
            const call = makeCall({ status: CallStatus.ONGOING });
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.acceptCall(CALL_ID, CALLEE_ID);

            expect(result.status).toBe(CallStatus.ONGOING);
            expect(callRepository.save).not.toHaveBeenCalled();
        });

        it('rejects accepting a call that is no longer RINGING (e.g. already cancelled)', async () => {
            callRepository.findOne.mockResolvedValue(makeCall({ status: CallStatus.CANCELLED }));
            await expect(service.acceptCall(CALL_ID, CALLEE_ID)).rejects.toThrow(BadRequestException);
        });

        it('marks an expired call MISSED and rejects the accept', async () => {
            const oldCreatedAt = new Date(Date.now() - 60_000); // > 45s ring timeout
            const call = makeCall({ createdAt: oldCreatedAt });
            callRepository.findOne.mockResolvedValue(call);

            await expect(service.acceptCall(CALL_ID, CALLEE_ID)).rejects.toThrow(BadRequestException);
            expect(call.status).toBe(CallStatus.MISSED);
            expect(callRepository.save).toHaveBeenCalledWith(call);
        });

        it('accepts a valid ringing call and moves it to ONGOING without setting startedAt', async () => {
            const call = makeCall();
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.acceptCall(CALL_ID, CALLEE_ID);

            expect(result.status).toBe(CallStatus.ONGOING);
            expect(result.startedAt).toBeNull();
        });
    });

    describe('markConnected', () => {
        it('sets startedAt the first time it is reported', async () => {
            const call = makeCall({ status: CallStatus.ONGOING });
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.markConnected(CALL_ID, CALLER_ID);

            expect(result.startedAt).toBeInstanceOf(Date);
        });

        it('does not overwrite startedAt on a second report', async () => {
            const firstConnect = new Date('2024-01-01T00:00:00Z');
            const call = makeCall({ status: CallStatus.ONGOING, startedAt: firstConnect });
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.markConnected(CALL_ID, CALLEE_ID);

            expect(result.startedAt).toBe(firstConnect);
            expect(callRepository.save).not.toHaveBeenCalled();
        });

        it('rejects a non-participant', async () => {
            callRepository.findOne.mockResolvedValue(makeCall({ status: CallStatus.ONGOING }));
            await expect(service.markConnected(CALL_ID, 'random-user')).rejects.toThrow(ForbiddenException);
        });
    });

    describe('rejectCall / cancelCall', () => {
        it('only the callee may reject', async () => {
            callRepository.findOne.mockResolvedValue(makeCall());
            await expect(service.rejectCall(CALL_ID, CALLER_ID)).rejects.toThrow(ForbiddenException);
        });

        it('only the caller may cancel', async () => {
            callRepository.findOne.mockResolvedValue(makeCall());
            await expect(service.cancelCall(CALL_ID, CALLEE_ID)).rejects.toThrow(ForbiddenException);
        });

        it('reject is idempotent once already resolved', async () => {
            const call = makeCall({ status: CallStatus.CANCELLED });
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.rejectCall(CALL_ID, CALLEE_ID);

            expect(result.status).toBe(CallStatus.CANCELLED); // unchanged
            expect(callRepository.save).not.toHaveBeenCalled();
        });

        it('cancel moves a ringing call to CANCELLED', async () => {
            const call = makeCall();
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.cancelCall(CALL_ID, CALLER_ID);

            expect(result.status).toBe(CallStatus.CANCELLED);
        });
    });

    describe('endCall', () => {
        it('rejects a non-participant', async () => {
            callRepository.findOne.mockResolvedValue(makeCall());
            await expect(service.endCall(CALL_ID, 'random-user')).rejects.toThrow(ForbiddenException);
        });

        it('ends an ONGOING call and computes duration from startedAt', async () => {
            const startedAt = new Date(Date.now() - 30_000); // 30s ago
            const call = makeCall({ status: CallStatus.ONGOING, startedAt });
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.endCall(CALL_ID, CALLER_ID);

            expect(result.status).toBe(CallStatus.ENDED);
            expect(result.durationSeconds).toBeGreaterThanOrEqual(29);
            expect(result.durationSeconds).toBeLessThanOrEqual(31);
        });

        it('ends an ONGOING call that never connected media with a 0 duration (not a crash)', async () => {
            const call = makeCall({ status: CallStatus.ONGOING, startedAt: null });
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.endCall(CALL_ID, CALLER_ID);

            expect(result.status).toBe(CallStatus.ENDED);
            expect(result.durationSeconds).toBe(0);
        });

        it('cancels a still-RINGING call instead of "ending" it', async () => {
            const call = makeCall({ status: CallStatus.RINGING });
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.endCall(CALL_ID, CALLEE_ID);

            expect(result.status).toBe(CallStatus.CANCELLED);
        });

        it('is idempotent on an already-terminal call', async () => {
            const call = makeCall({ status: CallStatus.REJECTED });
            callRepository.findOne.mockResolvedValue(call);

            const result = await service.endCall(CALL_ID, CALLEE_ID);

            expect(result.status).toBe(CallStatus.REJECTED);
            expect(callRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('sweepExpiredRingingCalls', () => {
        it('marks stale ringing calls as MISSED', async () => {
            const stale = [makeCall(), makeCall({ id: 'call-2' })];
            callRepository.find.mockResolvedValue(stale);

            const result = await service.sweepExpiredRingingCalls();

            expect(result.every((c) => c.status === CallStatus.MISSED)).toBe(true);
            expect(callRepository.save).toHaveBeenCalledWith(stale);
        });

        it('does nothing (and does not call save) when there is nothing stale', async () => {
            callRepository.find.mockResolvedValue([]);
            const result = await service.sweepExpiredRingingCalls();
            expect(result).toEqual([]);
            expect(callRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('sweepStaleOngoingCalls', () => {
        it('force-ends zombie ongoing calls, including ones that never got a startedAt', async () => {
            const stale = [
                makeCall({ status: CallStatus.ONGOING, startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) }),
                makeCall({ id: 'call-2', status: CallStatus.ONGOING, startedAt: null }),
            ];
            queryBuilder.getMany.mockResolvedValue(stale);

            const result = await service.sweepStaleOngoingCalls();

            expect(result).toHaveLength(2);
            expect(result.every((c) => c.status === CallStatus.ENDED)).toBe(true);
            expect(result[1].durationSeconds).toBe(0); // null startedAt -> 0, not a crash
        });
    });

    describe('handleUserDisconnect', () => {
        it('cancels calls the user was ringing out as caller', async () => {
            const ringing = [makeCall({ callerId: CALLER_ID, status: CallStatus.RINGING })];
            callRepository.find.mockResolvedValue(ringing);

            const result = await service.handleUserDisconnect(CALLER_ID);

            expect(result[0].status).toBe(CallStatus.CANCELLED);
            expect(callRepository.find).toHaveBeenCalledWith({
                where: { callerId: CALLER_ID, status: CallStatus.RINGING },
            });
        });
    });

    describe('endActiveCallsForUser', () => {
        it('ends ONGOING calls with a duration and cancels RINGING ones', async () => {
            const startedAt = new Date(Date.now() - 10_000);
            const active = [
                makeCall({ status: CallStatus.ONGOING, startedAt }),
                makeCall({ id: 'call-2', status: CallStatus.RINGING }),
            ];
            callRepository.find.mockResolvedValue(active);

            const result = await service.endActiveCallsForUser(CALLER_ID);

            expect(result[0].status).toBe(CallStatus.ENDED);
            expect(result[0].durationSeconds).toBeGreaterThan(0);
            expect(result[1].status).toBe(CallStatus.CANCELLED);
        });

        it('returns an empty array and skips save when there is nothing active', async () => {
            callRepository.find.mockResolvedValue([]);
            const result = await service.endActiveCallsForUser(CALLER_ID);
            expect(result).toEqual([]);
            expect(callRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('getTurnCredentials', () => {
        it('returns null when TURN is not configured', async () => {
            configService.get.mockReturnValue(undefined);
            const result = await service.getTurnCredentials(CALLER_ID);
            expect(result).toBeNull();
        });

        it('generates a valid HMAC-signed credential when TURN is configured', async () => {
            const url = 'turn.example.com:3478';
            const secret = 'super-secret';
            configService.get.mockImplementation((key: string) =>
                key === 'TURN_SERVER_URL' ? url : key === 'TURN_SECRET' ? secret : undefined,
            );

            const result = await service.getTurnCredentials(CALLER_ID);

            expect(result).not.toBeNull();
            expect(result!.username.endsWith(`:${CALLER_ID}`)).toBe(true);
            expect(result!.urls).toEqual([`turn:${url}?transport=udp`, `turn:${url}?transport=tcp`]);

            const expectedCredential = crypto.createHmac('sha1', secret).update(result!.username).digest('base64');
            expect(result!.credential).toBe(expectedCredential);
        });
    });
});
