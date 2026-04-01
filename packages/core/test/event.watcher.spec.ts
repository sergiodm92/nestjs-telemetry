import { TelemetryEventWatcher } from '../src/watchers/event.watcher';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';

describe('TelemetryEventWatcher', () => {
  let storage: InMemoryTelemetryStorage;
  let watcher: TelemetryEventWatcher;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    watcher = new TelemetryEventWatcher(storage);
  });

  it('records event with name and payload', async () => {
    await watcher.record('user.created', { userId: 123, email: 'a@b.com' }, 'UserService', 'onUserCreated');

    const entries = await storage.getByType(TelemetryEntryType.EVENT, {}, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].content.event).toBe('user.created');
    expect(entries[0].content.payload).toEqual({ userId: 123, email: 'a@b.com' });
    expect(entries[0].content.handlerClass).toBe('UserService');
    expect(entries[0].content.handlerMethod).toBe('onUserCreated');
  });

  it('tags event by name', async () => {
    await watcher.record('order.placed', {}, 'OrderService', 'onOrder');

    const entries = await storage.getByType(TelemetryEntryType.EVENT, {}, 0, 10);
    expect(entries[0].tags).toContain('event:order.placed');
  });
});
