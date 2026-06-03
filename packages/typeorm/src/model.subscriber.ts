import { v4 as uuidv4 } from 'uuid';
import {
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import {
  TelemetryStorage,
  TelemetryEntryType,
  TelemetryContext,
} from '@nestjs-telemetry/core';

export class TelemetryModelSubscriber
  implements EntitySubscriberInterface<any>
{
  constructor(private readonly storage: TelemetryStorage) {}

  afterInsert(event: InsertEvent<any>): void {
    this.record('CREATED', event.entity, event.metadata?.name, []);
  }

  afterUpdate(event: UpdateEvent<any>): void {
    const changedFields =
      event.updatedColumns?.map((col) => col.propertyName) || [];
    this.record('UPDATED', event.entity, event.metadata?.name, changedFields);
  }

  afterRemove(event: RemoveEvent<any>): void {
    // When the entity was not loaded (cascade / criteria removes), TypeORM
    // provides `entityId` as a mixed-id map (e.g. `{ id: 3 }`) rather than a
    // scalar. Unwrap it so the recorded id is the value, not the map object.
    const fallbackId =
      event.entityId && typeof event.entityId === 'object'
        ? Object.values(event.entityId)[0]
        : event.entityId;
    this.record(
      'DELETED',
      event.entity || { id: fallbackId },
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
