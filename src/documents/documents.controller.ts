import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Res,
    UseGuards,
    Logger,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiParam,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * Read-only by design: download is the only exposed operation. Upload, list,
 * metadata and delete were removed deliberately — rows in `documents` are not
 * writable through the API.
 */
@ApiTags('Documents')
@ApiBearerAuth('JWT-auth')
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
    private readonly logger = new Logger(DocumentsController.name);

    constructor(private readonly documentsService: DocumentsService) { }

    @Get(':id/file')
    @ApiOperation({
        summary: 'Download / display the actual file',
        description:
            'Streams the bytes through the API with the stored Content-Type. Images render inline; other types download as attachments. The bucket stays private and no presigned URL is ever handed to the client.',
    })
    @ApiParam({ name: 'id', description: 'Document UUID' })
    // Declared as a binary payload so Swagger UI renders a "Download file"
    // link instead of dumping raw bytes into the response panel as text.
    @ApiResponse({
        status: 200,
        description: 'Raw file bytes, sent with the stored Content-Type',
        content: {
            'application/octet-stream': {
                schema: { type: 'string', format: 'binary' },
            },
        },
    })
    @ApiResponse({ status: 404, description: 'Not found, or not owned by the caller' })
    async download(
        @CurrentUser() user: any,
        @Param('id', ParseUUIDPipe) id: string,
        @Res() res: Response,
    ) {
        // Ownership is checked (and a 404 thrown) before a single header is
        // written, so failures still get normal JSON error handling.
        const { stream, document } = await this.documentsService.getFileStream(user.userId, id);

        const disposition = document.mimeType.startsWith('image/') ? 'inline' : 'attachment';
        res.setHeader('Content-Type', document.mimeType);
        res.setHeader('Content-Length', document.size);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // HTTP headers are latin1, but real filenames contain things like the
        // U+202F narrow space macOS puts in screenshot names. Send an ASCII
        // fallback plus an RFC 5987 UTF-8 form so clients get the true name.
        const asciiName = document.originalName.replace(/[^\x20-\x7e]/g, '_');
        res.setHeader(
            'Content-Disposition',
            `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
        );
        // These are per-user private bytes — keep them out of shared caches.
        res.setHeader('Cache-Control', 'private, max-age=0, no-store');

        stream.on('error', (error) => {
            this.logger.error(`Stream failed for document ${id}: ${error.message}`);
            res.destroy(error);
        });
        stream.pipe(res);
    }
}
