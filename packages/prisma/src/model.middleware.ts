import { v4 as uuidv4 } from 'uuid';
import {
  TelemetryStorage,
  TelemetryEntryType,
  TelemetryContext,
} from '@nestjs-telemetry/core';

const WRITE_ACTIONS: Record<string, string> = {
  create: 'CREATED',
  createMany: 'CREATED',
  update: 'UPDATED',
  updateMany: 'UPDATED',
  upsert: 'UPDATED',
  delete: 'DELETED',
  deleteMany: 'DELETED',
};

export function createTelemetryModelMiddleware(storage: TelemetryStorage) {
  return async (params: any, next: (params: any) => Promise<any>) => {
    const action = WRITE_ACTIONS[params.action];
    if (!action) return next(params);
    if (!storage.isEnabled()) return next(params);

    const result = await next(params);

    const entityId = result?.id ?? result?.uuid ?? '';

    await storage.store({
      uuid: uuidv4(),
      type: TelemetryEntryType.MODEL,
      createdAt: new Date(),
      batchId: TelemetryContext.getBatchId() || '',
      content: {
        entity: params.model || 'Unknown',
        action,
        entityId,
        data: params.args?.data
          ? JSON.parse(JSON.stringify(params.args.data))
          : {},
      },
      userIdentifier: TelemetryContext.getUserIdentifier() || '',
      tenantId: TelemetryContext.getTenantId() || '',
      tags: [`model:${action.toLowerCase()}`, `entity:${params.model}`],
    });

    return result;
  };
}
