import { Injectable, OnModuleInit } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TelemetryContext } from '../context/telemetry-context';

@Injectable()
export class TelemetryScheduleWatcher implements OnModuleInit {
  constructor(private readonly storage: TelemetryStorage) {}

  onModuleInit(): void {
    // Hook into @nestjs/schedule via SchedulerRegistry if available
  }

  async wrap(
    className: string,
    methodName: string,
    fn: () => Promise<any>,
  ): Promise<any> {
    if (!this.storage.isEnabled()) return fn();

    const batchId = uuidv4();
    const start = Date.now();
    let status = 'completed';
    let exception = '';

    try {
      return await TelemetryContext.run({ batchId }, fn);
    } catch (err: any) {
      status = 'failed';
      exception = err?.message || String(err);
      throw err;
    } finally {
      const duration = Date.now() - start;
      await this.storage.store({
        uuid: uuidv4(),
        type: TelemetryEntryType.SCHEDULE,
        createdAt: new Date(),
        batchId,
        content: {
          class: className,
          method: methodName,
          status,
          duration,
          exception,
        },
        userIdentifier: '',
        tenantId: '',
        tags: [`schedule:${status}`],
      });
    }
  }
}
