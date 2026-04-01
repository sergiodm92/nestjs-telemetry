import { v4 as uuidv4 } from 'uuid';
import {
  TelemetryStorage,
  TelemetryEntryType,
  TelemetryContext,
} from '@nestjs-telemetry/core';

export class TelemetryModelSubscriber {
  constructor(private readonly storage: TelemetryStorage) {}

  async afterInsert(event: any): Promise<void> {
    this.record('CREATED', event.entity, event.metadata?.name, []);
  }

  async afterUpdate(event: any): Promise<void> {
    const changedFields = event.updatedColumns?.map(
      (col: any) => col.propertyName,
    ) || [];
    this.record('UPDATED', event.entity, event.metadata?.name, changedFields);
  }

  async afterRemove(event: any): Promise<void> {
    this.record(
      'DELETED',
      event.entity || { id: event.entityId },
      event.metadata?.name,
      [],
    );
  }

  private record(
    action: string,
    entity: any,
    entityName: string | undefined,
    changedFields: string[],
  ): void {
    if (!this.storage.isEnabled()) return;
    if (!entityName) return;

    if (
      entityName.toLowerCase().includes('telemetry') ||
      entityName.toLowerCase().includes('telescope')
    )
      return;

    const entityId = entity?.id ?? entity?.uuid ?? '';

    this.storage.store({
      uuid: uuidv4(),
      type: TelemetryEntryType.MODEL,
      createdAt: new Date(),
      batchId: TelemetryContext.getBatchId() || '',
      content: {
        entity: entityName,
        action,
        entityId,
        changedFields,
      },
      userIdentifier: TelemetryContext.getUserIdentifier() || '',
      tenantId: TelemetryContext.getTenantId() || '',
      tags: [`model:${action.toLowerCase()}`, `entity:${entityName}`],
    });
  }
}
