import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

// SigV4 presigned URLs signed with long-lived IAM credentials cap out at 7
// days — stay comfortably under that so a URL never expires mid-session.
const PRESIGNED_URL_TTL_SECONDS = 6 * 24 * 60 * 60;

/**
 * Thin wrapper around the S3 SDK — generic on purpose (key/buffer in, key or
 * presigned URL out) so it's reusable for anything we store in the bucket,
 * not just avatars (e.g. message media later).
 */
@Injectable()
export class S3Service {
    private readonly logger = new Logger(S3Service.name);
    private readonly client: S3Client;
    private readonly bucket: string;

    constructor(private configService: ConfigService) {
        this.bucket = this.configService.get<string>('AWS_S3_BUCKET_NAME') || '';
        this.client = new S3Client({
            region: this.configService.get<string>('AWS_REGION'),
            credentials: {
                accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
                secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
            },
        });
    }

    /**
     * Upload a buffer under `key`. The bucket is private — this returns the
     * key itself (not a URL); callers must presign separately.
     */
    async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<string> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: buffer,
                ContentType: contentType,
            }),
        );
        return key;
    }

    /**
     * Best-effort delete — a missing/already-removed object shouldn't fail
     * whatever operation is replacing it (e.g. uploading a new avatar).
     */
    async deleteObject(key: string): Promise<void> {
        try {
            await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        } catch (error) {
            this.logger.warn(`Failed to delete S3 object "${key}": ${error.message}`);
        }
    }

    /**
     * Presigned GET URL for a private object. Returns null for a falsy key
     * so callers (notably AvatarUrlInterceptor) can pass "no avatar" through
     * cleanly instead of needing their own null-check.
     */
    async getPresignedUrl(key: string | null | undefined): Promise<string | null> {
        if (!key) return null;
        try {
            return await getSignedUrl(
                this.client,
                new GetObjectCommand({ Bucket: this.bucket, Key: key }),
                { expiresIn: PRESIGNED_URL_TTL_SECONDS },
            );
        } catch (error) {
            this.logger.error(`Failed to presign S3 key "${key}": ${error.message}`);
            return null;
        }
    }

    /** Unique key for a user's avatar — one folder per user, unique filename per upload. */
    buildAvatarKey(userId: string, ext: string): string {
        return `avatars/${userId}/${randomUUID()}.${ext}`;
    }
}
