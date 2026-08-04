import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { UserDocument } from './entities/user-document.entity';

// S3Service comes from the @Global S3Module, so nothing to import for it here.
@Module({
    imports: [TypeOrmModule.forFeature([UserDocument])],
    controllers: [DocumentsController],
    providers: [DocumentsService],
})
export class DocumentsModule { }
