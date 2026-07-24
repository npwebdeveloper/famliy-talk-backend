import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not, IsNull } from 'typeorm';
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import { User } from '../users/entities/user.entity';

@Injectable()
export class NotificationsService implements OnModuleInit {
    private readonly logger = new Logger(NotificationsService.name);
    private enabled = false;
    private messaging: Messaging;

    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,
        private configService: ConfigService,
    ) { }

    onModuleInit() {
        const serviceAccountPath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');

        if (!serviceAccountPath) {
            this.logger.warn('FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled');
            return;
        }

        if (!fs.existsSync(serviceAccountPath)) {
            this.logger.warn(`Firebase service account file not found at ${serviceAccountPath} — push notifications disabled`);
            return;
        }

        try {
            const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            const app = initializeApp({
                credential: cert(serviceAccount),
            });
            this.messaging = getMessaging(app);
            this.enabled = true;
            this.logger.log('Firebase Admin initialized — push notifications enabled');
        } catch (error) {
            this.logger.error(`Failed to initialize Firebase Admin: ${error.message}`);
        }
    }

    /**
     * Send a push notification to a single user (looks up their FCM token).
     * Silently no-ops if Firebase is not configured or user has no token.
     */
    async sendToUser(
        userId: string,
        notification: { title: string; body: string },
        data: Record<string, string> = {},
    ): Promise<void> {
        if (!this.enabled) return;

        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'fcmToken'],
        });

        if (!user?.fcmToken) return;

        await this.sendToToken(user.id, user.fcmToken, notification, data);
    }

    /**
     * Push "new message" notification to recipients who are OFFLINE and have an FCM token.
     * Online users already receive the message via socket — no push needed.
     *
     * Privacy: message content is NEVER included in the push — only the sender's
     * name and a generic body. The app fetches the actual message on open.
     */
    async sendNewMessagePush(
        recipientIds: string[],
        senderName: string,
        meta: { conversationId: string; messageId: string },
    ): Promise<void> {
        if (!this.enabled || recipientIds.length === 0) return;

        const offlineRecipients = await this.userRepository.find({
            where: {
                id: In(recipientIds),
                isOnline: false,
                fcmToken: Not(IsNull()),
            },
            select: ['id', 'fcmToken'],
        });

        if (offlineRecipients.length === 0) return;

        const notification = {
            title: senderName || 'Family Talk',
            body: 'New message 💬',
        };
        const data = {
            type: 'new_message',
            conversationId: meta.conversationId,
            messageId: meta.messageId,
        };

        await Promise.allSettled(
            offlineRecipients.map(u => this.sendToToken(u.id, u.fcmToken!, notification, data)),
        );
    }

    /**
     * Push an incoming-call notification — sent once per call, only when the
     * callee has no live socket connection (offline/backgrounded/killed).
     *
     * Deliberately data-only (no top-level `notification` block): a message
     * with a `notification` block is auto-displayed by the OS as a plain
     * tray notification and never reaches app code, so the phone can't
     * actually ring — the user only sees a silent banner and has to tap it
     * before anything happens. A data-only, high-priority message instead
     * wakes the app's background notification task (see
     * backgroundNotificationTask.ts in the app), which calls RNCallKeep
     * directly to show the real native incoming-call UI and ring — the same
     * mechanism a real phone call uses, so it also respects the device's
     * silent/vibrate/DND setting automatically instead of always playing a sound.
     */
    async sendIncomingCallPush(
        calleeId: string,
        callerName: string,
        meta: { callId: string; conversationId: string; type: 'audio' | 'video' },
    ): Promise<void> {
        if (!this.enabled) return;

        const user = await this.userRepository.findOne({
            where: { id: calleeId },
            select: ['id', 'fcmToken'],
        });
        if (!user?.fcmToken) return;

        try {
            await this.messaging.send({
                token: user.fcmToken,
                data: {
                    type: 'incoming_call',
                    callId: meta.callId,
                    conversationId: meta.conversationId,
                    callType: meta.type,
                    callerName: callerName || 'Family Talk',
                },
                android: {
                    priority: 'high',
                },
                apns: {
                    headers: { 'apns-priority': '10' },
                    payload: { aps: { 'content-available': 1 } },
                },
            });
        } catch (error) {
            if (
                error.code === 'messaging/registration-token-not-registered' ||
                error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/invalid-argument'
            ) {
                await this.userRepository.update({ id: calleeId }, { fcmToken: null });
                this.logger.log(`Cleared stale FCM token for user ${calleeId}`);
            } else {
                this.logger.error(`Incoming-call push failed for user ${calleeId}: ${error.message}`);
            }
        }
    }

    /**
     * Push "your contact joined" notification to a user whose saved contact just registered.
     */
    async sendContactJoinedPush(
        ownerId: string,
        contactName: string,
        newUserId: string,
    ): Promise<void> {
        if (!this.enabled) return;

        await this.sendToUser(
            ownerId,
            {
                title: 'Family Talk',
                body: `${contactName} joined Family Talk! Say hi 👋`,
            },
            {
                type: 'contact_joined',
                userId: newUserId,
            },
        );
    }

    private async sendToToken(
        userId: string,
        token: string,
        notification: { title: string; body: string },
        data: Record<string, string>,
    ): Promise<void> {
        try {
            await this.messaging.send({
                token,
                notification,
                data,
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'family_talk_messages',
                        sound: 'default',
                    },
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: 1,
                        },
                    },
                },
            });
        } catch (error) {
            // Token is stale (app uninstalled / token rotated) — remove it so we stop retrying
            if (
                error.code === 'messaging/registration-token-not-registered' ||
                error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/invalid-argument'
            ) {
                await this.userRepository.update({ id: userId }, { fcmToken: null });
                this.logger.log(`Cleared stale FCM token for user ${userId}`);
            } else {
                this.logger.error(`FCM send failed for user ${userId}: ${error.message}`);
            }
        }
    }

}
