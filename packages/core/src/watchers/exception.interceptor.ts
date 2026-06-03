import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TelemetryContext } from '../context/telemetry-context';

const MAX_TRACE_LENGTH = 5000;

/**
 * Records an unhandled exception as a telemetry entry. Shared by the
 * interceptor (auto-wired global capture) and the filter (manual/scoped use).
 *
 * Pure side effect — it never alters control flow, so callers stay responsible
 * for propagating the original exception.
 */
export function recordException(
  storage: TelemetryStorage,
  exception: any,
  req: any,
): void {
  if (!storage.isEnabled()) return;

  const trace: string = exception?.stack || '';
  const firstLine = trace.split('\n')[1]?.trim() || '';
  const fileMatch = firstLine.match(/\((.+):(\d+):\d+\)/);

  storage.store({
    uuid: uuidv4(),
    type: TelemetryEntryType.EXCEPTION,
    createdAt: new Date(),
    batchId: TelemetryContext.getBatchId() || '',
    content: {
      class: exception?.constructor?.name || 'UnknownError',
      message: exception?.message || String(exception),
      trace:
        trace.length > MAX_TRACE_LENGTH
          ? trace.substring(0, MAX_TRACE_LENGTH) + '... [truncated]'
          : trace,
      file: fileMatch?.[1] || '',
      line: fileMatch?.[2] || '',
      location: firstLine,
      uri: req?.path || req?.url || '',
      method: req?.method || '',
      cause: exception?.cause ? String(exception.cause) : '',
    },
    userIdentifier: TelemetryContext.getUserIdentifier() || '',
    tenantId: TelemetryContext.getTenantId() || '',
    tags: [`exception:${exception?.constructor?.name || 'unknown'}`],
  });
}

/**
 * Captures unhandled exceptions without taking over the response.
 *
 * A global `@Catch()` ExceptionFilter that re-throws does NOT compose with the
 * host application's own filters — NestJS selects a single catch-all filter and
 * a re-throw from it escapes the exception layer, bypassing the consumer's
 * filter entirely. An interceptor that records on `catchError` and re-emits the
 * error lets the normal exception pipeline (and the consumer's filters) run
 * unchanged, which is the correct way to observe exceptions passively.
 */
@Injectable()
export class TelemetryExceptionInterceptor implements NestInterceptor {
  constructor(private readonly storage: TelemetryStorage) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      catchError((err) => {
        recordException(this.storage, err, req);
        return throwError(() => err);
      }),
    );
  }
}
