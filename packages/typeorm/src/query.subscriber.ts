import { v4 as uuidv4 } from 'uuid';
import { AfterQueryEvent, EntitySubscriberInterface } from 'typeorm';
import {
  TelemetryStorage,
  TelemetryEntryType,
  TelemetryContext,
} from '@nestjs-telemetry/core';

export class TelemetryQuerySubscriber
  implements EntitySubscriberInterface<any>
{
  constructor(private readonly storage: TelemetryStorage) {}

  afterQuery(event: AfterQueryEvent<any>): void {
    if (!this.storage.isEnabled()) return;

    const sql: string = event.query || '';
    if (this.shouldSkip(sql)) return;

    this.storage.store({
      uuid: uuidv4(),
      type: TelemetryEntryType.QUERY,
      createdAt: new Date(),
      batchId: TelemetryContext.getBatchId() || '',
      content: {
        sql,
        type: this.getSqlType(sql),
        duration: event.executionTime || 0,
        parameters: event.parameters || [],
      },
      userIdentifier: TelemetryContext.getUserIdentifier() || '',
      tenantId: TelemetryContext.getTenantId() || '',
      tags: [`query:${this.getSqlType(sql).toLowerCase()}`],
    });
  }

  private shouldSkip(sql: string): boolean {
    const lower = sql.toLowerCase().trim();
    if (lower.includes('telemetry_entries')) return true;
    if (lower === 'select 1' || lower.startsWith('select version')) return true;
    return false;
  }

  private getSqlType(sql: string): string {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT')) return 'SELECT';
    if (trimmed.startsWith('INSERT')) return 'INSERT';
    if (trimmed.startsWith('UPDATE')) return 'UPDATE';
    if (trimmed.startsWith('DELETE')) return 'DELETE';
    if (
      trimmed.startsWith('CREATE') ||
      trimmed.startsWith('ALTER') ||
      trimmed.startsWith('DROP')
    )
      return 'DDL';
    return 'OTHER';
  }
}
