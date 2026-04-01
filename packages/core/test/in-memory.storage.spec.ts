import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntry } from '../src/model/telemetry-entry';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';

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

describe('InMemoryTelemetryStorage', () => {
  let storage: InMemoryTelemetryStorage;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(10);
  });

  it('stores and retrieves entries by type', async () => {
    const entry = makeEntry();
    await storage.store(entry);
    const results = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(results).toHaveLength(1);
    expect(results[0].uuid).toBe(entry.uuid);
  });

  it('retrieves entry by uuid', async () => {
    const entry = makeEntry({ uuid: 'specific-uuid' });
    await storage.store(entry);
    const found = await storage.getByUuid('specific-uuid');
    expect(found).not.toBeNull();
    expect(found!.uuid).toBe('specific-uuid');
  });

  it('returns null for unknown uuid', async () => {
    const result = await storage.getByUuid('nonexistent-uuid');
    expect(result).toBeNull();
  });

  it('retrieves entries by batchId', async () => {
    const e1 = makeEntry({ batchId: 'batch-abc', createdAt: new Date('2024-01-01T10:00:00Z') });
    const e2 = makeEntry({ batchId: 'batch-abc', type: TelemetryEntryType.QUERY, createdAt: new Date('2024-01-01T10:00:01Z') });
    const e3 = makeEntry({ batchId: 'other-batch' });
    await storage.store(e1);
    await storage.store(e2);
    await storage.store(e3);
    const results = await storage.getByBatchId('batch-abc');
    expect(results).toHaveLength(2);
    expect(results.map((e) => e.batchId).every((id) => id === 'batch-abc')).toBe(true);
    // sorted by createdAt ascending
    expect(results[0].createdAt.getTime()).toBeLessThanOrEqual(results[1].createdAt.getTime());
  });

  it('evicts oldest entries when maxEntries exceeded', async () => {
    const storage2 = new InMemoryTelemetryStorage(3);
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ uuid: `uuid-${i}` }),
    );
    for (const e of entries) {
      await storage2.store(e);
    }
    const results = await storage2.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(results).toHaveLength(3);
    // newest entries are retained (unshift adds newest first, pop removes last/oldest)
    const uuids = results.map((e) => e.uuid);
    expect(uuids).toContain('uuid-4');
    expect(uuids).toContain('uuid-3');
    expect(uuids).toContain('uuid-2');
    expect(uuids).not.toContain('uuid-0');
    expect(uuids).not.toContain('uuid-1');
  });

  it('returns stats with counts per type', async () => {
    await storage.store(makeEntry({ type: TelemetryEntryType.REQUEST }));
    await storage.store(makeEntry({ type: TelemetryEntryType.REQUEST }));
    await storage.store(makeEntry({ type: TelemetryEntryType.QUERY }));
    const stats = await storage.getStats();
    expect(stats[TelemetryEntryType.REQUEST]).toBe(2);
    expect(stats[TelemetryEntryType.QUERY]).toBe(1);
    expect(stats[TelemetryEntryType.LOG]).toBe(0);
  });

  it('paginates results', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.store(makeEntry({ uuid: `uuid-page-${i}` }));
    }
    const page0 = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 2);
    const page1 = await storage.getByType(TelemetryEntryType.REQUEST, {}, 1, 2);
    const page2 = await storage.getByType(TelemetryEntryType.REQUEST, {}, 2, 2);
    expect(page0).toHaveLength(2);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    // all pages combined should contain all 5 entries
    const allUuids = [...page0, ...page1, ...page2].map((e) => e.uuid);
    expect(new Set(allUuids).size).toBe(5);
  });

  it('filters by userIdentifier', async () => {
    await storage.store(makeEntry({ userIdentifier: 'alice' }));
    await storage.store(makeEntry({ userIdentifier: 'bob' }));
    const results = await storage.getByType(TelemetryEntryType.REQUEST, { userIdentifier: 'alice' }, 0, 10);
    expect(results).toHaveLength(1);
    expect(results[0].userIdentifier).toBe('alice');
  });

  it('filters by HTTP method', async () => {
    await storage.store(makeEntry({ content: { method: 'GET', uri: '/a', status: 200 } }));
    await storage.store(makeEntry({ content: { method: 'POST', uri: '/b', status: 201 } }));
    const results = await storage.getByType(TelemetryEntryType.REQUEST, { method: 'POST' }, 0, 10);
    expect(results).toHaveLength(1);
    expect(results[0].content.method).toBe('POST');
  });

  it('filters by status group', async () => {
    await storage.store(makeEntry({ content: { method: 'GET', uri: '/ok', status: 200 } }));
    await storage.store(makeEntry({ content: { method: 'GET', uri: '/not-found', status: 404 } }));
    await storage.store(makeEntry({ content: { method: 'GET', uri: '/error', status: 500 } }));
    const results4xx = await storage.getByType(TelemetryEntryType.REQUEST, { statusGroup: '4xx' }, 0, 10);
    expect(results4xx).toHaveLength(1);
    expect(results4xx[0].content.status).toBe(404);
    const results2xx = await storage.getByType(TelemetryEntryType.REQUEST, { statusGroup: '2xx' }, 0, 10);
    expect(results2xx).toHaveLength(1);
    expect(results2xx[0].content.status).toBe(200);
  });

  it('clears all entries', async () => {
    await storage.store(makeEntry({ type: TelemetryEntryType.REQUEST }));
    await storage.store(makeEntry({ type: TelemetryEntryType.LOG }));
    await storage.clear();
    const requests = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    const logs = await storage.getByType(TelemetryEntryType.LOG, {}, 0, 10);
    expect(requests).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it('clears entries by type', async () => {
    await storage.store(makeEntry({ type: TelemetryEntryType.REQUEST }));
    await storage.store(makeEntry({ type: TelemetryEntryType.LOG }));
    await storage.clearByType(TelemetryEntryType.REQUEST);
    const requests = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    const logs = await storage.getByType(TelemetryEntryType.LOG, {}, 0, 10);
    expect(requests).toHaveLength(0);
    expect(logs).toHaveLength(1);
  });

  it('prunes entries older than cutoff', async () => {
    const old = makeEntry({ createdAt: new Date('2024-01-01T00:00:00Z') });
    const recent = makeEntry({ createdAt: new Date('2024-06-01T00:00:00Z') });
    await storage.store(old);
    await storage.store(recent);
    const cutoff = new Date('2024-03-01T00:00:00Z');
    const pruned = await storage.pruneOlderThan(cutoff);
    expect(pruned).toBe(1);
    const results = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(results).toHaveLength(1);
    expect(results[0].uuid).toBe(recent.uuid);
  });

  it('toggles enabled state', async () => {
    expect(storage.isEnabled()).toBe(true);
    storage.setEnabled(false);
    expect(storage.isEnabled()).toBe(false);
    storage.setEnabled(true);
    expect(storage.isEnabled()).toBe(true);
  });

  it('does not store when disabled', async () => {
    storage.setEnabled(false);
    await storage.store(makeEntry());
    const results = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(results).toHaveLength(0);
  });

  it('returns distinct user identifiers', async () => {
    await storage.store(makeEntry({ userIdentifier: 'alice' }));
    await storage.store(makeEntry({ userIdentifier: 'bob' }));
    await storage.store(makeEntry({ userIdentifier: 'alice' }));
    await storage.store(makeEntry({ userIdentifier: '' }));
    const identifiers = await storage.getDistinctUserIdentifiers();
    expect(identifiers).toEqual(['alice', 'bob']);
  });

  it('returns distinct tags', async () => {
    await storage.store(makeEntry({ tags: ['tag-a', 'tag-b'] }));
    await storage.store(makeEntry({ tags: ['tag-b', 'tag-c'] }));
    await storage.store(makeEntry({ tags: [] }));
    const tags = await storage.getDistinctTags();
    expect(tags).toEqual(['tag-a', 'tag-b', 'tag-c']);
  });

  it('filters by search term in content values', async () => {
    await storage.store(makeEntry({ content: { method: 'GET', uri: '/products', status: 200 } }));
    await storage.store(makeEntry({ content: { method: 'POST', uri: '/checkout', status: 201 } }));
    await storage.store(makeEntry({ content: { method: 'GET', uri: '/products/123', status: 200 } }));
    const results = await storage.getByType(TelemetryEntryType.REQUEST, { search: 'products' }, 0, 10);
    expect(results).toHaveLength(2);
    results.forEach((r) => expect(String(r.content.uri)).toContain('products'));
  });
});
