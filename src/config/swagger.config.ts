import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'api/docs';

/**
 * Swagger / OpenAPI documentation setup.
 *
 * Enabled by default in development. In production (NODE_ENV=production)
 * docs are OFF unless SWAGGER_ENABLED=true is set explicitly.
 *
 * Returns true when docs were mounted, so the caller can log the URL.
 */
export function setupSwagger(app: INestApplication): boolean {
    const isProduction = process.env.NODE_ENV === 'production';
    const explicitlyEnabled = process.env.SWAGGER_ENABLED === 'true';

    if (isProduction && !explicitlyEnabled) {
        return false;
    }

    const config = new DocumentBuilder()
        .setTitle('Family Talk API')
        .setDescription(
            'REST API for the Family Talk chat app — phone OTP auth, profiles, ' +
            'contacts sync, conversations, messages with delivery/read receipts, ' +
            'and FCM push notifications.\n\n' +
            'Real-time events (new_message, message_delivered, message_read, typing, ' +
            'online status) are delivered over Socket.IO — see MESSAGE_STATUS_FRONTEND.md.',
        )
        .setVersion('1.0')
        .addBearerAuth(
            {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description:
                    'Access token from POST /auth/verify-otp. Click Authorize and paste the token (without "Bearer ").',
            },
            'JWT-auth',
        )
        .addTag('Auth', 'Phone OTP login, JWT issue/refresh, logout')
        .addTag('Users', 'Profile, avatar, search, contacts sync, FCM token')
        .addTag('Conversations', 'Create/list conversations, mark as read')
        .addTag('Messages', 'Send/list/delete messages, read receipts')
        .addTag('Documents', 'Private per-user file storage — upload, list, stream, delete')
        .build();

    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup(SWAGGER_PATH, app, document, {
        swaggerOptions: {
            persistAuthorization: true, // keep the JWT across page reloads
        },
    });

    return true;
}
