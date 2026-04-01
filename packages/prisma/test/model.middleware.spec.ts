import { createTelemetryModelMiddleware } from '../src/model.middleware';
import { TelemetryEntryType } from '@nestjs-telemetry/core';

function createMockStorage() {
  return {
    store: jest.fn(async () => {}),
    isEnabled: jest.fn(() => true),
  };
}

describe('Prisma Model Middleware', () => {
  it('records create action as MODEL entry', async () => {
    const storage = createMockStorage();
    const middleware = createTelemetryModelMiddleware(storage as any);

    const next = jest.fn().mockResolvedValue({ id: 1, name: 'Alice' });
    const params = { model: 'User', action: 'create', args: { data: { name: 'Alice' } } };

    await middleware(params as any, next);

    expect(storage.store).toHaveBeenCalledTimes(1);
    const entry = storage.store.mock.calls[0][0];
    expect(entry.type).toBe(TelemetryEntryType.MODEL);
    expect(entry.content.action).toBe('CREATED');
    expect(entry.content.entity).toBe('User');
  });

  it('records update action', async () => {
    const storage = createMockStorage();
    const middleware = createTelemetryModelMiddleware(storage as any);

    const next = jest.fn().mockResolvedValue({ id: 1, name: 'Bob' });
    await middleware({ model: 'User', action: 'update', args: { data: { name: 'Bob' } } } as any, next);

    const entry = storage.store.mock.calls[0][0];
    expect(entry.content.action).toBe('UPDATED');
  });

  it('records delete action', async () => {
    const storage = createMockStorage();
    const middleware = createTelemetryModelMiddleware(storage as any);

    const next = jest.fn().mockResolvedValue({ id: 1 });
    await middleware({ model: 'User', action: 'delete', args: { where: { id: 1 } } } as any, next);

    const entry = storage.store.mock.calls[0][0];
    expect(entry.content.action).toBe('DELETED');
  });

  it('ignores read actions', async () => {
    const storage = createMockStorage();
    const middleware = createTelemetryModelMiddleware(storage as any);

    const next = jest.fn().mockResolvedValue([]);
    await middleware({ model: 'User', action: 'findMany', args: {} } as any, next);

    expect(storage.store).not.toHaveBeenCalled();
  });
});
