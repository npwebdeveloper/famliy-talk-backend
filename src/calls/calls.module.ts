import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { Call } from './entities/call.entity';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Call]),
        ConversationsModule,
        UsersModule,
    ],
    controllers: [CallsController],
    providers: [CallsService],
    exports: [CallsService],
})
export class CallsModule { }
