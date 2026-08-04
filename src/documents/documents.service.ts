import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Readable } from 'stream';
import { UserDocument } from './entities/user-document.entity';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class DocumentsService {
    constructor(
        @InjectRepository(UserDocument)
        private readonly documentsRepository: Repository<UserDocument>,
        private readonly s3Service: S3Service,
    ) { }

    /**
     * Bytes for a document the caller owns. Returns the stored metadata
     * alongside the stream so the controller sets the headers recorded at
     * upload time rather than anything S3 echoes back.
     */
    async getFileStream(
        userId: string,
        id: string,
    ): Promise<{ stream: Readable; document: UserDocument }> {
        const document = await this.getOwned(userId, id);
        const { body } = await this.s3Service.getObjectStream(document.s3Key);
        return { stream: body, document };
    }

    /**
     * The single ownership gate. Scoping the lookup by `ownerId` means another
     * user's document id is indistinguishable from one that doesn't exist —
     * a 404 either way, so this leaks nothing about what other people store.
     */
    private async getOwned(userId: string, id: string): Promise<UserDocument> {
        const document = await this.documentsRepository.findOne({
            where: { id, ownerId: userId },
        });
        if (!document) {
            throw new NotFoundException('Document not found');
        }
        return document;
    }
}
