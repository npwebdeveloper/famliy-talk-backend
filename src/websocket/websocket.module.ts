import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { MessagesModule } from '../messages/messages.module';
import { UsersModule } from '../users/users.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
    imports: [
        forwardRef(() => MessagesModule),
        UsersModule,
        ConversationsModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get<string>('JWT_SECRET'),
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [ChatGateway],
    exports: [ChatGateway],
})
export class WebsocketModule { }
