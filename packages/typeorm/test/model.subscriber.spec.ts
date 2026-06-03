import { TelemetryModelSubscriber } from '../src/model.subscriber';
import { TelemetryEntryType } from '@nestjs-telemetry/core';

function createMockStorage() {
  return {
    store: jest.fn(async () => {}),
    isEnabled: jest.fn(() => true),
  };
}

describe('TelemetryModelSubscriber', () => {
  it('records entity insert', async () => {
    const storage = createMockStorage();
    const subscriber = new TelemetryModelSubscriber(storage as any);

    await subscriber.afterInsert({
      entity: { id: 1, name: 'Alice' },
      metadata: { name: 'User', tableName: 'users' },
    } as any);

    expect(storage.store).toHaveBeenCalledTimes(1);
    const entry = storage.store.mock.calls[0][0];
    expect(entry.type).toBe(TelemetryEntryType.MODEL);
    expect(entry.content.action).toBe('CREATED');
    expect(entry.content.entity).toBe('User');
    expect(entry.content.entityId).toBe(1);
  });

  it('records entity update with changed fields', async () => {
    const storage = createMockStorage();
    const subscriber = new TelemetryModelSubscriber(storage as any);

    await subscriber.afterUpdate({
      entity: { id: 2, name: 'Bob' },
      metadata: { name: 'User', tableName: 'users' },
      databaseEntity: { id: 2, name: 'Robert' },
      updatedColumns: [{ propertyName: 'name' }],
    } as any);

    const entry = storage.store.mock.calls[0][0];
    expect(entry.content.action).toBe('UPDATED');
    expect(entry.content.changedFields).toContain('name');
  });

  it('records entity deletion', async () => {
    const storage = createMockStorage();
    const subscriber = new TelemetryModelSubscriber(storage as any);

    await subscriber.afterRemove({
      entity: { id: 3 },
      metadata: { name: 'User', tableName: 'users' },
      entityId: 3,
    } as any);

    const entry = storage.store.mock.calls[0][0];
    expect(entry.content.action).toBe('DELETED');
  });

  it('unwraps mixed-id map when entity is not loaded (cascade remove)', async () => {
    const storage = createMockStorage();
    const subscriber = new TelemetryModelSubscriber(storage as any);

    await subscriber.afterRemove({
      metadata: { name: 'User', tableName: 'users' },
      entityId: { id: 3 },
    } as any);

    const entry = storage.store.mock.calls[0][0];
    expect(entry.content.action).toBe('DELETED');
    expect(entry.content.entityId).toBe(3);
  });

  it('skips telemetry own entities', async () => {
    const storage = createMockStorage();
    const subscriber = new TelemetryModelSubscriber(storage as any);

    await subscriber.afterInsert({
      entity: { id: 1 },
      metadata: { name: 'TelemetryEntry', tableName: 'telemetry_entries' },
    } as any);

    expect(storage.store).not.toHaveBeenCalled();
  });
});
