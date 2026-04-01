import { LoggerService, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TelemetryContext } from '../context/telemetry-context';

@Injectable()
export class TelemetryLogWatcher implements LoggerService {
  constructor(
    private readonly storage: TelemetryStorage,
    private readonly basePackage: string,
  ) {}

  log(message: any, context?: string): void {
    this.record('LOG', message, context);
  }

  error(message: any, trace?: string, context?: string): void {
    this.record('ERROR', message, context, trace);
  }

  warn(message: any, context?: string): void {
    this.record('WARN', message, context);
  }

  debug(message: any, context?: string): void {
    this.record('DEBUG', message, context);
  }

  verbose(message: any, context?: string): void {
    this.record('VERBOSE', message, context);
  }

  private record(
    level: string,
    message: any,
    context?: string,
    trace?: string,
  ): void {
    if (!this.storage.isEnabled()) return;
    if (this.basePackage && context && !context.startsWith(this.basePackage)) return;

    this.storage.store({
      uuid: uuidv4(),
      type: TelemetryEntryType.LOG,
      createdAt: new Date(),
      batchId: TelemetryContext.getBatchId() || '',
      content: {
        level,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        context: context || '',
        trace: trace || '',
      },
      userIdentifier: TelemetryContext.getUserIdentifier() || '',
      tenantId: TelemetryContext.getTenantId() || '',
      tags: [`log:${level.toLowerCase()}`],
    });
  }
}
