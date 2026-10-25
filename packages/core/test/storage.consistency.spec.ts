import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { SqliteTelemetryStorage } from '../src/storage/sqlite.storage';
import { TelemetryStorage } from '../src/storage/telemetry-storage.interface';
import { TelemetryEntry } from '../src/model/telemetry-entry';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { FILTER_CASES, expectedUuids, seedEntries } from './support/entries';

const PAGE_SIZE = 7;

interface StorageUnderTest {
  storage: TelemetryStorage;
  dispose(): void;
}

const storages: [string, () => StorageUnderTest][] = [
  ['in-memory', () => ({ storage: new InMemoryTelemetryStorage(1000), dispose: () => undefined })],
  [
    'sqlite',
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestjs-telemetry-storage-'));
      const storage = new SqliteTelemetryStorage(path.join(dir, 'telemetry.db'));
      return {
        storage,
        dispose: () => {
          storage.close();
          fs.rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  ],
];

describe.each(storages)('%s storage: countByType and getByType describe the same result set', (_name, create) => {
  let current: StorageUnderTest;
  let storage: TelemetryStorage;
  const all = seedEntries();

  beforeEach(async () => {
    current = create();
    storage = current.storage;
    for (const entry of all) await storage.store(entry);
  });

  afterEach(() => current.dispose());

  async function listAllPages(filters: Parameters<TelemetryStorage['getByType']>[1]) {
    const pages: string[][] = [];
    for (let page = 0; ; page++) {
      const entries = await storage.getByType(TelemetryEntryType.REQUEST, filters, page, PAGE_SIZE);
      if (entries.length === 0) return pages;
      pages.push(entries.map((entry) => entry.uuid));
    }
  }

  it.each(FILTER_CASES)('the total and the pages agree for: $name', async ({ filters, matches }) => {
    const expected = expectedUuids(all, TelemetryEntryType.REQUEST, matches);

    const total = await storage.countByType(TelemetryEntryType.REQUEST, filters);
    const pages = await listAllPages(filters);

    expect(total).toBe(expected.length);
    // Every page but the last is full, which only holds if filtering happens before paginating.
    for (const page of pages.slice(0, -1)) expect(page).toHaveLength(PAGE_SIZE);
    expect(pages.flat()).toEqual(expected);
  });

  it('counts each type on its own', async () => {
    expect(await storage.countByType(TelemetryEntryType.LOG, {})).toBe(5);
    expect(await storage.countByType(TelemetryEntryType.EXCEPTION, {})).toBe(0);
  });

  it('keeps counting and listing entries that were stored but not flushed yet', async () => {
    const late: TelemetryEntry = {
      ...all[0],
      uuid: 'late-arrival',
      createdAt: new Date('2027-01-01T00:00:00Z'),
      content: { method: 'PATCH', uri: '/late', status: 200 },
    };
    await storage.store(late);

    const filters = { method: 'PATCH' };
    expect(await storage.countByType(TelemetryEntryType.REQUEST, filters)).toBe(1);
    const [entry] = await storage.getByType(TelemetryEntryType.REQUEST, filters, 0, PAGE_SIZE);
    expect(entry.uuid).toBe('late-arrival');
  });

  it('pages entries created in the same millisecond in a stable, newest-stored-first order', async () => {
    await storage.clear();
    const sameInstant = new Date('2026-06-01T12:00:00.000Z');
    for (let i = 0; i < 5; i++) {
      await storage.store({ ...all[0], uuid: `tie-${i}`, createdAt: sameInstant });
    }

    const pages: string[][] = [];
    for (let page = 0; page < 3; page++) {
      const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, page, 2);
      pages.push(entries.map((entry) => entry.uuid));
    }

    expect(pages).toEqual([['tie-4', 'tie-3'], ['tie-2', 'tie-1'], ['tie-0']]);
  });
});
