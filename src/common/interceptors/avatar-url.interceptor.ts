import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { S3Service } from '../../s3/s3.service';

/**
 * Global HTTP interceptor: recursively walks every response body and
 * replaces any `avatarUrl` string (an S3 object key — the bucket is private)
 * with a presigned URL.
 *
 * `avatarUrl` shows up nested at many depths (conversation participants,
 * message senders, search results, synced contacts, ...) and new endpoints
 * will keep adding more. Resolving it in one global place means every one of
 * those is covered automatically, instead of relying on each service to
 * remember to presign — which is exactly the kind of spot a raw S3 key would
 * otherwise leak into a response unnoticed.
 */
@Injectable()
export class AvatarUrlInterceptor implements NestInterceptor {
    constructor(private readonly s3Service: S3Service) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(switchMap((data) => from(this.resolve(data))));
    }

    private async resolve(value: any, seen: WeakSet<object> = new WeakSet()): Promise<any> {
        if (value === null || value === undefined || value instanceof Date) {
            return value;
        }

        if (Array.isArray(value)) {
            return Promise.all(value.map((item) => this.resolve(item, seen)));
        }

        if (typeof value === 'object') {
            // Guard against circular TypeORM relations (e.g. participant <-> conversation)
            if (seen.has(value)) return value;
            seen.add(value);

            const entries = await Promise.all(
                Object.entries(value).map(async ([key, val]) => {
                    if (key === 'avatarUrl' && typeof val === 'string' && val) {
                        return [key, await this.s3Service.getPresignedUrl(val)];
                    }
                    return [key, await this.resolve(val, seen)];
                }),
            );
            return Object.fromEntries(entries);
        }

        return value;
    }
}
