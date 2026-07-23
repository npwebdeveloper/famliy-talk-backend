import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, In, MoreThan } from 'typeorm';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { Call, CallStatus } from '../src/calls/entities/call.entity';
import { Conversation } from '../src/conversations/entities/conversation.entity';
import { ConversationParticipant } from '../src/conversations/entities/conversation-participant.entity';
import { OtpVerification } from '../src/auth/entities/otp-verification.entity';
import { User } from '../src/users/entities/user.entity';
import { UserBlock } from '../src/users/entities/user-block.entity';

/**
 * Real-flow verification, not mocks: boots the actual app (real DB, real
 * NestJS DI, real Socket.IO gateway), registers real test users through the
 * real OTP flow, and drives real socket connections through the call state
 * machine exactly as the app does. All test data is scoped to a unique phone
 * prefix and torn down in afterAll — nothing pre-existing is touched.
 */
describe('Calls (e2e)', () => {
    let app: INestApplication;
    let httpServer: any;
    let baseUrl: string;
    const STATIC_OTP = process.env.STATIC_OTP || '123456';

    let callRepo: Repository<Call>;
    let conversationRepo: Repository<Conversation>;
    let participantRepo: Repository<ConversationParticipant>;
    let otpRepo: Repository<OtpVerification>;
    let userRepo: Repository<User>;
    let userBlockRepo: Repository<UserBlock>;

    // Unique-per-run prefix so repeated test runs never collide with each other
    // or with real data.
    const runId = Date.now().toString().slice(-8);
    const LABEL_DIGITS: Record<string, string> = { A: '1', B: '2', C: '3' };
    const phoneFor = (label: string) => `+1999${runId}${LABEL_DIGITS[label]}`;

    const createdUserIds: string[] = [];
    const createdConversationIds: string[] = [];

    interface TestUser { userId: string; token: string; phoneNumber: string; }

    async function registerUser(label: string): Promise<TestUser> {
        const phoneNumber = phoneFor(label);
        await request(httpServer).post('/auth/send-otp').send({ phoneNumber }).expect(201);
        const res = await request(httpServer)
            .post('/auth/verify-otp')
            .send({ phoneNumber, otp: STATIC_OTP })
            .expect(201);
        createdUserIds.push(res.body.user.id);
        return { userId: res.body.user.id, token: res.body.accessToken, phoneNumber };
    }

    async function createConversation(token: string, participantIds: string[]): Promise<string> {
        const res = await request(httpServer)
            .post('/conversations')
            .set('Authorization', `Bearer ${token}`)
            .send({ participantIds })
            .expect(201);
        createdConversationIds.push(res.body.id);
        return res.body.id;
    }

    function connectSocket(token: string): Promise<Socket> {
        return new Promise((resolve, reject) => {
            const socket = io(baseUrl, { auth: { token }, transports: ['websocket'], forceNew: true });
            const timeout = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
            socket.once('connect', () => { clearTimeout(timeout); resolve(socket); });
            socket.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
        });
    }

    function waitForEvent<T = any>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
            socket.once(event, (data: T) => { clearTimeout(timeout); resolve(data); });
        });
    }

    function emitAck<T = any>(socket: Socket, event: string, payload: any): Promise<T> {
        return new Promise((resolve) => socket.emit(event, payload, (ack: T) => resolve(ack)));
    }

    /**
     * Registers the "call_ringing" listener BEFORE sending the invite (via
     * Promise.all, synchronously in the same tick) — awaiting the ack first
     * and only then calling waitForEvent is a race: the server can emit
     * call_ringing before the ack even returns, so a listener registered
     * afterwards misses an event that already fired.
     */
    async function inviteAndWaitForRinging(
        callerSocket: Socket,
        calleeSocket: Socket,
        payload: { conversationId: string; calleeId: string; type: string },
    ) {
        const [ack, ringing] = await Promise.all([
            emitAck(callerSocket, 'call_invite', payload),
            waitForEvent(calleeSocket, 'call_ringing'),
        ]);
        return { ack, ringing };
    }

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();
        await app.listen(0); // random free port

        httpServer = app.getHttpServer();
        const address = httpServer.address();
        baseUrl = `http://localhost:${address.port}`;

        callRepo = moduleFixture.get(getRepositoryToken(Call));
        conversationRepo = moduleFixture.get(getRepositoryToken(Conversation));
        participantRepo = moduleFixture.get(getRepositoryToken(ConversationParticipant));
        otpRepo = moduleFixture.get(getRepositoryToken(OtpVerification));
        userRepo = moduleFixture.get(getRepositoryToken(User));
        userBlockRepo = moduleFixture.get(getRepositoryToken(UserBlock));
    }, 30000);

    afterAll(async () => {
        // Disconnect sockets FIRST — ChatGateway.handleDisconnect looks up the
        // user for the offline broadcast, which throws if that row is already
        // gone. Doing this after the DB cleanup below races handleDisconnect
        // against the delete and crashes the whole process (unhandled
        // rejection inside a socket.io event callback, outside any promise
        // chain Jest is watching).
        socketA?.disconnect();
        socketB?.disconnect();
        await new Promise((r) => setTimeout(r, 200)); // let disconnect handlers finish

        // Delete in FK-dependency order — only rows this test run created.
        if (createdUserIds.length) {
            const relatedCalls = await callRepo.find({
                where: [{ callerId: In(createdUserIds) }, { calleeId: In(createdUserIds) }],
            });
            const callIds = relatedCalls.map((c) => c.id);
            if (callIds.length) await callRepo.delete(callIds).catch(() => undefined);
        }
        if (createdConversationIds.length) {
            await participantRepo.delete({ conversationId: In(createdConversationIds) }).catch(() => undefined);
            await conversationRepo.delete(createdConversationIds).catch(() => undefined);
        }
        if (createdUserIds.length) {
            await userBlockRepo.delete({ blockerId: In(createdUserIds) }).catch(() => undefined);
            await userBlockRepo.delete({ blockedId: In(createdUserIds) }).catch(() => undefined);
            const phones = Object.values(phoneCache);
            if (phones.length) await otpRepo.delete({ phoneNumber: In(phones) }).catch(() => undefined);
            await userRepo.delete(createdUserIds).catch(() => undefined);
        }
        await app.close();
    }, 30000);

    // Tracks label -> phone number so afterAll can clean up OTP rows too.
    const phoneCache: Record<string, string> = {};

    let userA: TestUser;
    let userB: TestUser;
    let userC: TestUser;
    let conversationAB: string;
    let socketA: Socket;
    let socketB: Socket;

    it('registers three real users through the actual OTP flow', async () => {
        userA = await registerUser('A');
        userB = await registerUser('B');
        userC = await registerUser('C');
        phoneCache.A = userA.phoneNumber;
        phoneCache.B = userB.phoneNumber;
        phoneCache.C = userC.phoneNumber;

        expect(userA.userId).toBeDefined();
        expect(userB.userId).toBeDefined();
        expect(userA.userId).not.toBe(userB.userId);
    });

    it('creates a real conversation between A and B', async () => {
        conversationAB = await createConversation(userA.token, [userB.userId]);
        expect(conversationAB).toBeDefined();
    });

    it('connects real sockets for A and B', async () => {
        socketA = await connectSocket(userA.token);
        socketB = await connectSocket(userB.token);
        expect(socketA.connected).toBe(true);
        expect(socketB.connected).toBe(true);
    });

    describe('full call lifecycle', () => {
        let callId: string;

        it('A calls B — B receives call_ringing with correct caller info', async () => {
            const [ack, ringing] = await Promise.all([
                emitAck(socketA, 'call_invite', { conversationId: conversationAB, calleeId: userB.userId, type: 'video' }),
                waitForEvent(socketB, 'call_ringing'),
            ]);

            expect(ack.success).toBe(true);
            expect(ringing.callerId).toBe(userA.userId);
            expect(ringing.type).toBe('video');
            callId = ack.call.id;

            const dbCall = await callRepo.findOne({ where: { id: callId } });
            expect(dbCall?.status).toBe(CallStatus.RINGING);
        });

        it('B accepts — A receives call_accepted, DB flips to ONGOING (startedAt still null)', async () => {
            const [ack, accepted] = await Promise.all([
                emitAck(socketB, 'call_accept', { callId }),
                waitForEvent(socketA, 'call_accepted'),
            ]);

            expect(ack.success).toBe(true);
            expect(accepted.callId).toBe(callId);

            const dbCall = await callRepo.findOne({ where: { id: callId } });
            expect(dbCall?.status).toBe(CallStatus.ONGOING);
            expect(dbCall?.startedAt).toBeNull(); // not set until call_connected
        });

        it('WebRTC signaling relay: offer/answer/ICE reach the other party unmodified', async () => {
            const fakeSdp = { type: 'offer', sdp: 'v=0...' };
            const [, offerReceived] = await Promise.all([
                null,
                waitForEvent(socketB, 'call_offer'),
                socketA.emit('call_offer', { callId, toUserId: userB.userId, sdp: fakeSdp }),
            ]);
            expect(offerReceived.sdp).toEqual(fakeSdp);
            expect(offerReceived.fromUserId).toBe(userA.userId);

            const fakeCandidate = { candidate: 'candidate:1 1 UDP...' };
            const [, candidateReceived] = await Promise.all([
                null,
                waitForEvent(socketA, 'ice_candidate'),
                socketB.emit('ice_candidate', { callId, toUserId: userA.userId, candidate: fakeCandidate }),
            ]);
            expect(candidateReceived.candidate).toEqual(fakeCandidate);
        });

        it('call_connected sets startedAt exactly once (idempotent on repeat)', async () => {
            await emitAck(socketB, 'call_connected', { callId });
            const afterFirst = await callRepo.findOne({ where: { id: callId } });
            expect(afterFirst?.startedAt).not.toBeNull();
            const firstStartedAt = afterFirst!.startedAt!.getTime();

            await new Promise((r) => setTimeout(r, 50));
            await emitAck(socketA, 'call_connected', { callId }); // reported again by the other party

            const afterSecond = await callRepo.findOne({ where: { id: callId } });
            expect(afterSecond?.startedAt?.getTime()).toBe(firstStartedAt); // unchanged
        });

        it('B ends the call — A receives call_ended with a real computed duration', async () => {
            const [ack, ended] = await Promise.all([
                emitAck(socketB, 'call_end', { callId }),
                waitForEvent(socketA, 'call_ended'),
            ]);

            expect(ack.success).toBe(true);
            expect(ended.status).toBe('ended');
            expect(ended.durationSeconds).toBeGreaterThanOrEqual(0);

            const dbCall = await callRepo.findOne({ where: { id: callId } });
            expect(dbCall?.status).toBe(CallStatus.ENDED);
            expect(dbCall?.durationSeconds).not.toBeNull();
        });

        it('shows up correctly in call history', async () => {
            const res = await request(httpServer)
                .get(`/calls/conversation/${conversationAB}`)
                .set('Authorization', `Bearer ${userA.token}`)
                .expect(200);
            expect(res.body.calls.some((c: any) => c.id === callId)).toBe(true);
        });
    });

    it('reject: B declines — A receives call_rejected, DB shows REJECTED', async () => {
        const { ack: inviteAck } = await inviteAndWaitForRinging(socketA, socketB, { conversationId: conversationAB, calleeId: userB.userId, type: 'audio' });
        expect(inviteAck.success).toBe(true);

        const [, rejected] = await Promise.all([
            emitAck(socketB, 'call_reject', { callId: inviteAck.call.id }),
            waitForEvent(socketA, 'call_rejected'),
        ]);
        expect(rejected.callId).toBe(inviteAck.call.id);

        const dbCall = await callRepo.findOne({ where: { id: inviteAck.call.id } });
        expect(dbCall?.status).toBe(CallStatus.REJECTED);
    });

    it('cancel: A cancels before B responds — B receives call_cancelled', async () => {
        const { ack: inviteAck } = await inviteAndWaitForRinging(socketA, socketB, { conversationId: conversationAB, calleeId: userB.userId, type: 'audio' });

        const [, cancelled] = await Promise.all([
            emitAck(socketA, 'call_cancel', { callId: inviteAck.call.id }),
            waitForEvent(socketB, 'call_cancelled'),
        ]);
        expect(cancelled.callId).toBe(inviteAck.call.id);

        const dbCall = await callRepo.findOne({ where: { id: inviteAck.call.id } });
        expect(dbCall?.status).toBe(CallStatus.CANCELLED);
    });

    it('busy: C cannot reach B while B is already ringing from A', async () => {
        const { ack: inviteAck } = await inviteAndWaitForRinging(socketA, socketB, { conversationId: conversationAB, calleeId: userB.userId, type: 'audio' });

        const conversationBC = await createConversation(userB.token, [userC.userId]);
        const socketC = await connectSocket(userC.token);
        const busyAck = await emitAck(socketC, 'call_invite', { conversationId: conversationBC, calleeId: userB.userId, type: 'audio' });

        expect(busyAck.success).toBe(false);
        expect(busyAck.reason).toBe('BUSY');

        socketC.disconnect();
        await emitAck(socketA, 'call_cancel', { callId: inviteAck.call.id }); // reset state
    });

    it('glare: B inviting A back while A\'s call to B is still ringing resolves to the existing call, not a duplicate', async () => {
        const { ack: abAck } = await inviteAndWaitForRinging(socketA, socketB, { conversationId: conversationAB, calleeId: userB.userId, type: 'audio' });

        const baAck = await emitAck(socketB, 'call_invite', { conversationId: conversationAB, calleeId: userA.userId, type: 'audio' });

        expect(baAck.success).toBe(false);
        expect(baAck.reason).toBe('GLARE_EXISTING_CALL');

        await emitAck(socketA, 'call_cancel', { callId: abAck.call.id }); // reset state
    });

    it('rejects calling someone who is not a participant of the given conversation', async () => {
        const ack = await emitAck(socketA, 'call_invite', { conversationId: conversationAB, calleeId: userC.userId, type: 'audio' });
        expect(ack.success).toBe(false);
    });

    it('blocked users cannot call each other', async () => {
        await request(httpServer)
            .post(`/users/block/${userC.userId}`)
            .set('Authorization', `Bearer ${userA.token}`)
            .expect(201);

        const conversationAC = await createConversation(userA.token, [userC.userId]);
        const socketC = await connectSocket(userC.token);

        const ack = await emitAck(socketC, 'call_invite', { conversationId: conversationAC, calleeId: userA.userId, type: 'audio' });
        expect(ack.success).toBe(false);

        await request(httpServer)
            .delete(`/users/block/${userC.userId}`)
            .set('Authorization', `Bearer ${userA.token}`)
            .expect(200);

        // Unblocked — the same call should now succeed
        const ack2 = await emitAck(socketC, 'call_invite', { conversationId: conversationAC, calleeId: userA.userId, type: 'audio' });
        expect(ack2.success).toBe(true);
        await emitAck(socketA, 'call_cancel', { callId: ack2.call.id });

        socketC.disconnect();
    });

    // Runs BEFORE the rate-limit test below on purpose — that test deliberately
    // exhausts A's invite quota, which would otherwise make this one fail too.
    it('an accept attempt on an expired (stale) call is rejected and the call flips to MISSED', async () => {
        const inviteAck = await emitAck(socketA, 'call_invite', { conversationId: conversationAB, calleeId: userB.userId, type: 'audio' });
        expect(inviteAck.success).toBe(true);
        // Backdate createdAt to simulate the 45s ring timeout having passed —
        // exercises the exact same expiry branch the real sweep would hit.
        await callRepo.update(inviteAck.call.id, { createdAt: new Date(Date.now() - 60_000) });

        const acceptAck = await emitAck(socketB, 'call_accept', { callId: inviteAck.call.id });
        expect(acceptAck.success).toBe(false);

        const dbCall = await callRepo.findOne({ where: { id: inviteAck.call.id } });
        expect(dbCall?.status).toBe(CallStatus.MISSED);
    });

    it('rate-limits a caller after repeated invites to the same callee', async () => {
        // Earlier tests in this run already made a few invites as A — the cap
        // is on total recent invites, not specific to this test, so top up to
        // the limit dynamically rather than assuming a clean slate.
        const RATE_LIMIT_MAX_INVITES = 10;
        const windowStart = new Date(Date.now() - 60_000);
        const existingCount = await callRepo.count({ where: { callerId: userA.userId, createdAt: MoreThan(windowStart) } });
        const remaining = Math.max(0, RATE_LIMIT_MAX_INVITES - existingCount);

        for (let i = 0; i < remaining; i++) {
            const ack = await emitAck(socketA, 'call_invite', { conversationId: conversationAB, calleeId: userB.userId, type: 'audio' });
            expect(ack.success).toBe(true);
            await emitAck(socketA, 'call_cancel', { callId: ack.call.id });
        }

        const rateLimitedAck = await emitAck(socketA, 'call_invite', { conversationId: conversationAB, calleeId: userB.userId, type: 'audio' });
        expect(rateLimitedAck.success).toBe(false);
        expect(rateLimitedAck.error).toMatch(/too many/i);
    }, 20000);

    it('GET /calls/turn-credentials returns either null or a well-formed credential', async () => {
        const res = await request(httpServer)
            .get('/calls/turn-credentials')
            .set('Authorization', `Bearer ${userA.token}`)
            .expect(200);

        if (res.body !== null) {
            expect(res.body.username).toContain(userA.userId);
            expect(typeof res.body.credential).toBe('string');
            expect(Array.isArray(res.body.urls)).toBe(true);
        }
    });

    it('GET /calls/analytics/me reflects the calls made in this run', async () => {
        const res = await request(httpServer)
            .get('/calls/analytics/me')
            .set('Authorization', `Bearer ${userA.token}`)
            .expect(200);

        expect(res.body.totalCalls).toBeGreaterThan(0);
        expect(res.body.answerRate).toBeGreaterThanOrEqual(0);
        expect(res.body.answerRate).toBeLessThanOrEqual(1);
    });
});
