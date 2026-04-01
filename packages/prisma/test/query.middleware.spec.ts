import { createTelemetryQueryMiddleware } from '../src/query.middleware';
import { TelemetryEntryType } from '@nestjs-telemetry/core';

function createMockStorage() {
  return {
    store: jest.fn(async () => {}),
    isEnabled: jest.fn(() => true),
  };
}

describe('Prisma Query Middleware', () => {
  it('records query with model, action, and duration', async () => {
    const storage = createMockStorage();
    const middleware = createTelemetryQueryMiddleware(storage as any);

    const next = jest.fn().mockResolvedValue({ id: 1, name: 'Alice' });
    const params = { model: 'User', action: 'findMany', args: { where: { active: true } } };

    await middleware(params as any, next);

    expect(storage.store).toHaveBeenCalledTimes(1);
    const entry = storage.store.mock.calls[0][0];
    expect(entry.type).toBe(TelemetryEntryType.QUERY);
    expect(entry.content.model).toBe('User');
    expect(entry.content.action).toBe('findMany');
    expect(entry.content.duration).toBeDefined();
  });

  it('still throws when next() throws', async () => {
    const storage = createMockStorage();
    const middleware = createTelemetryQueryMiddleware(storage as any);

    const next = jest.fn().mockRejectedValue(new Error('DB error'));
    const params = { model: 'User', action: 'create', args: {} };

    await expect(middleware(params as any, next)).rejects.toThrow('DB error');
    expect(storage.store).toHaveBeenCalledTimes(1);
  });
});
