import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TelemetryContext } from '../context/telemetry-context';

@Injectable()
export class TelemetryEventWatcher {
  constructor(private readonly storage: TelemetryStorage) {}

  async record(
    eventName: string,
    payload: any,
    handlerClass: string,
    handlerMethod: string,
  ): Promise<void> {
    if (!this.storage.isEnabled()) return;

    await this.storage.store({
      uuid: uuidv4(),
      type: TelemetryEntryType.EVENT,
      createdAt: new Date(),
      batchId: TelemetryContext.getBatchId() || '',
      content: {
        event: eventName,
        eventClass: typeof payload === 'object' ? payload?.constructor?.name || '' : '',
        payload: this.serializePayload(payload),
        handlerClass,
        handlerMethod,
      },
      userIdentifier: TelemetryContext.getUserIdentifier() || '',
      tenantId: TelemetryContext.getTenantId() || '',
      tags: [`event:${eventName}`],
    });
  }

  private serializePayload(payload: any): any {
    if (payload === null || payload === undefined) return {};
    if (typeof payload !== 'object') return { value: payload };
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch {
      return { toString: String(payload) };
    }
  }
}
