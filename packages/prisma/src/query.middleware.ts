import { v4 as uuidv4 } from 'uuid';
import {
  TelemetryStorage,
  TelemetryEntryType,
  TelemetryContext,
} from '@nestjs-telemetry/core';

export function createTelemetryQueryMiddleware(storage: TelemetryStorage) {
  return async (params: any, next: (params: any) => Promise<any>) => {
    if (!storage.isEnabled()) return next(params);

    const start = Date.now();
    let error: any = null;

    try {
      return await next(params);
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const duration = Date.now() - start;
      const sqlType = actionToSqlType(params.action);

      await storage.store({
        uuid: uuidv4(),
        type: TelemetryEntryType.QUERY,
        createdAt: new Date(),
        batchId: TelemetryContext.getBatchId() || '',
        content: {
          model: params.model || 'Unknown',
          action: params.action,
          type: sqlType,
          duration,
          args: params.args ? JSON.parse(JSON.stringify(params.args)) : {},
          error: error?.message || '',
        },
        userIdentifier: TelemetryContext.getUserIdentifier() || '',
        tenantId: TelemetryContext.getTenantId() || '',
        tags: [`query:${sqlType.toLowerCase()}`],
      });
    }
  };
}

function actionToSqlType(action: string): string {
  if (action.startsWith('find') || action === 'count' || action === 'aggregate' || action === 'groupBy') return 'SELECT';
  if (action.startsWith('create')) return 'INSERT';
  if (action.startsWith('update') || action === 'upsert') return 'UPDATE';
  if (action.startsWith('delete')) return 'DELETE';
  return 'OTHER';
}
