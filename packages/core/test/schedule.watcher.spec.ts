import { TelemetryScheduleWatcher } from '../src/watchers/schedule.watcher';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';

describe('TelemetryScheduleWatcher', () => {
  let storage: InMemoryTelemetryStorage;
  let watcher: TelemetryScheduleWatcher;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    watcher = new TelemetryScheduleWatcher(storage);
  });

  it('records successful scheduled task execution', async () => {
    await watcher.wrap('CleanupService', 'runCleanup', async () => {
      // simulate work
    });

    const entries = await storage.getByType(TelemetryEntryType.SCHEDULE, {}, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].content.class).toBe('CleanupService');
    expect(entries[0].content.method).toBe('runCleanup');
    expect(entries[0].content.status).toBe('completed');
    expect(entries[0].content.duration).toBeDefined();
  });

  it('records failed scheduled task with exception info', async () => {
    await expect(
      watcher.wrap('CronJob', 'doWork', async () => {
        throw new Error('cron failed');
      }),
    ).rejects.toThrow('cron failed');

    const entries = await storage.getByType(TelemetryEntryType.SCHEDULE, {}, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].content.status).toBe('failed');
    expect(entries[0].content.exception).toBe('cron failed');
  });
});
