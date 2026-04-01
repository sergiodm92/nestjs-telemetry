import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TelemetryContext } from '../context/telemetry-context';

const HIT_THRESHOLD_MS = 2;

@Injectable()
export class TelemetryCacheInterceptor implements NestInterceptor {
  constructor(private readonly storage: TelemetryStorage) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.storage.isEnabled()) return next.handle();

    const start = Date.now();
    const className = context.getClass()?.name || 'Unknown';
    const methodName = context.getHandler()?.name || 'unknown';
    const key = `${className}.${methodName}`;

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        const operation = duration < HIT_THRESHOLD_MS ? 'HIT' : 'MISS';

        this.storage.store({
          uuid: uuidv4(),
          type: TelemetryEntryType.CACHE,
          createdAt: new Date(),
          batchId: TelemetryContext.getBatchId() || '',
          content: {
            operation,
            cacheName: '',
            key,
            duration,
          },
          userIdentifier: TelemetryContext.getUserIdentifier() || '',
          tenantId: TelemetryContext.getTenantId() || '',
          tags: [`cache:${operation.toLowerCase()}`],
        });
      }),
    );
  }
}
