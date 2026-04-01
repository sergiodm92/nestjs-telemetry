import { SqliteTelemetryStorage } from '../src/storage/sqlite.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { TelemetryEntry } from '../src/model/telemetry-entry';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB = path.join(__dirname, '.test-telemetry.db');

function makeEntry(overrides: Partial<TelemetryEntry> = {}): TelemetryEntry {
  return {
    uuid: `uuid-${Math.random().toString(36).slice(2, 8)}`,
    type: TelemetryEntryType.REQUEST,
    createdAt: new Date(),
    batchId: 'batch-1',
    content: { method: 'GET', uri: '/test', status: 200 },
    userIdentifier: '',
    tenantId: '',
    tags: [],
    ...overrides,
  };
}

describe('SqliteTelemetryStorage', () => {
  let storage: SqliteTelemetryStorage;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    storage = new SqliteTelemetryStorage(TEST_DB);
  });

  afterEach(() => {
    storage.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('stores and retrieves entries by type', async () => {
    const entry = makeEntry();
    await storage.store(entry);
    await storage.flush();
    const results = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(results).toHaveLength(1);
    expect(results[0].uuid).toBe(entry.uuid);
  });

  it('retrieves entry by uuid from buffer before flush', async () => {
    const entry = makeEntry({ uuid: 'buf-uuid' });
    await storage.store(entry);
    const found = await storage.getByUuid('buf-uuid');
    expect(found).not.toBeNull();
    expect(found!.uuid).toBe('buf-uuid');
  });

  it('retrieves entry by uuid from DB after flush', async () => {
    const entry = makeEntry({ uuid: 'db-uuid' });
    await storage.store(entry);
    await storage.flush();
    const found = await storage.getByUuid('db-uuid');
    expect(found).not.toBeNull();
  });

  it('returns stats merging buffer and DB', async () => {
    await storage.store(makeEntry({ type: TelemetryEntryType.REQUEST }));
    await storage.flush();
    await storage.store(makeEntry({ type: TelemetryEntryType.REQUEST }));
    const stats = await storage.getStats();
    expect(stats['REQUEST']).toBe(2);
  });

  it('prunes old entries from DB', async () => {
    await storage.store(makeEntry({ createdAt: new Date('2020-01-01') }));
    await storage.store(makeEntry({ createdAt: new Date() }));
    await storage.flush();
    const pruned = await storage.pruneOlderThan(new Date('2023-01-01'));
    expect(pruned).toBe(1);
  });

  it('clears all entries from buffer and DB', async () => {
    await storage.store(makeEntry());
    await storage.flush();
    await storage.store(makeEntry());
    await storage.clear();
    const stats = await storage.getStats();
    expect(stats['REQUEST']).toBe(0);
  });

  it('returns memory info with buffer and DB counts', async () => {
    await storage.store(makeEntry());
    await storage.flush();
    await storage.store(makeEntry());
    const info = await storage.getMemoryInfo();
    expect(info.type).toBe('sqlite');
    expect(info.bufferSize).toBe(1);
    expect(info.dbEntries).toBe(1);
    expect(info.totalEntries).toBe(2);
  });
});
