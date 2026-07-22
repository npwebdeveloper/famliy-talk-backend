import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';

// Global: S3Service is cross-cutting infrastructure (like ConfigService),
// needed by UsersService, ChatGateway and the global AvatarUrlInterceptor —
// importing S3Module in every one of those would just be noise.
@Global()
@Module({
    providers: [S3Service],
    exports: [S3Service],
})
export class S3Module { }
