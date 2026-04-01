import { Catch, ArgumentsHost, ExceptionFilter, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TelemetryContext } from '../context/telemetry-context';

const MAX_TRACE_LENGTH = 5000;

@Catch()
@Injectable()
export class TelemetryExceptionFilter implements ExceptionFilter {
  constructor(private readonly storage: TelemetryStorage) {}

  catch(exception: any, host: ArgumentsHost): void {
    if (this.storage.isEnabled()) {
      this.record(exception, host);
    }
    throw exception;
  }

  private record(exception: any, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();

    const trace = exception?.stack || '';
    const firstLine = trace.split('\n')[1]?.trim() || '';
    const fileMatch = firstLine.match(/\((.+):(\d+):\d+\)/);

    this.storage.store({
      uuid: uuidv4(),
      type: TelemetryEntryType.EXCEPTION,
      createdAt: new Date(),
      batchId: TelemetryContext.getBatchId() || '',
      content: {
        class: exception?.constructor?.name || 'UnknownError',
        message: exception?.message || String(exception),
        trace: trace.length > MAX_TRACE_LENGTH
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
}
