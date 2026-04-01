import { TelemetryLogWatcher } from '../src/watchers/log.watcher';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';

describe('TelemetryLogWatcher', () => {
  let storage: InMemoryTelemetryStorage;
  let logger: TelemetryLogWatcher;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    logger = new TelemetryLogWatcher(storage, '');
  });

  it('records log messages', async () => {
    logger.log('Hello world', 'TestContext');

    const entries = await storage.getByType(TelemetryEntryType.LOG, {}, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].content.level).toBe('LOG');
    expect(entries[0].content.message).toBe('Hello world');
    expect(entries[0].content.context).toBe('TestContext');
  });

  it('records error level with stack trace', async () => {
    logger.error('Failed!', 'Error stack here', 'TestContext');

    const entries = await storage.getByType(TelemetryEntryType.LOG, {}, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].content.level).toBe('ERROR');
    expect(entries[0].content.trace).toBe('Error stack here');
  });

  it('records warn level', async () => {
    logger.warn('Watch out', 'WarnCtx');

    const entries = await storage.getByType(TelemetryEntryType.LOG, {}, 0, 10);
    expect(entries[0].content.level).toBe('WARN');
  });

  it('skips own telemetry logs when basePackage is set', async () => {
    const filtered = new TelemetryLogWatcher(storage, 'app');
    filtered.log('internal', 'TelemetryModule');

    const entries = await storage.getByType(TelemetryEntryType.LOG, {}, 0, 10);
    expect(entries).toHaveLength(0);
  });

  it('allows logs matching basePackage', async () => {
    const filtered = new TelemetryLogWatcher(storage, 'app');
    filtered.log('app message', 'app.UserService');

    const entries = await storage.getByType(TelemetryEntryType.LOG, {}, 0, 10);
    expect(entries).toHaveLength(1);
  });
});
