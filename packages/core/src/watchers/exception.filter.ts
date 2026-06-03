import { Catch, ArgumentsHost, ExceptionFilter, Injectable } from '@nestjs/common';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { recordException } from './exception.interceptor';

/**
 * Record-only exception filter, kept for manual/scoped use via `@UseFilters`.
 *
 * Do NOT bind this globally (APP_FILTER): a global catch-all filter that
 * re-throws bypasses the host application's own exception filters. For
 * application-wide capture use {@link TelemetryExceptionInterceptor}, which the
 * module auto-wires.
 */
@Catch()
@Injectable()
export class TelemetryExceptionFilter implements ExceptionFilter {
  constructor(private readonly storage: TelemetryStorage) {}

  catch(exception: any, host: ArgumentsHost): void {
    recordException(this.storage, exception, host.switchToHttp().getRequest());
    throw exception;
  }
}
