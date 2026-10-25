import { TelemetryEntry } from '../../src/model/telemetry-entry';
import { TelemetryEntryType } from '../../src/model/telemetry-entry-type';
import { EntryFilters } from '../../src/storage/telemetry-storage.interface';

const METHODS = ['POST', 'GET', 'DELETE'];
const STATUSES = [200, 201, 400, 404, 500, 302];

/**
 * 60 REQUEST entries in ascending createdAt order (storing them in this order makes both storages
 * list them newest first), whose method, status, user and tenant cycle with different periods so
 * every filter below matches a scattered subset. Plus a few LOG entries that must never leak
 * into a REQUEST listing.
 */
export function seedEntries(): TelemetryEntry[] {
  const base = Date.parse('2026-01-01T00:00:00Z');
  const requests: TelemetryEntry[] = Array.from({ length: 60 }, (_, i) => ({
    uuid: `req-${String(i).padStart(2, '0')}`,
    type: TelemetryEntryType.REQUEST,
    createdAt: new Date(base + i * 1000),
    batchId: `batch-${i}`,
    content: {
      method: METHODS[i % 3],
      uri: i % 7 === 0 ? `/orders/${i}` : `/items/${i}`,
      status: STATUSES[i % 6],
    },
    userIdentifier: i % 4 === 0 ? 'alice' : i % 4 === 1 ? 'bob' : '',
    tenantId: i % 5 === 0 ? 't1' : '',
    tags: [],
  }));
  const logs: TelemetryEntry[] = Array.from({ length: 5 }, (_, i) => ({
    uuid: `log-${i}`,
    type: TelemetryEntryType.LOG,
    createdAt: new Date(base + 100_000 + i * 1000),
    batchId: '',
    content: { level: 'INFO', message: 'items orders POST 404' },
    userIdentifier: 'alice',
    tenantId: 't1',
    tags: [],
  }));
  return [...requests, ...logs];
}

export interface FilterCase {
  name: string;
  /** The filters as the dashboard sends them (query string) and as the storage takes them. */
  filters: EntryFilters;
  /** An independent statement of what the filters mean, so the storages are checked against it. */
  matches: (entry: TelemetryEntry) => boolean;
}

const statusGroup = (entry: TelemetryEntry): number => Math.floor(entry.content.status / 100);

export const FILTER_CASES: FilterCase[] = [
  { name: 'no filter', filters: {}, matches: () => true },
  { name: 'method', filters: { method: 'POST' }, matches: (e) => e.content.method === 'POST' },
  { name: 'method, any case', filters: { method: 'post' }, matches: (e) => e.content.method === 'POST' },
  { name: 'status group', filters: { statusGroup: '4xx' }, matches: (e) => statusGroup(e) === 4 },
  {
    name: 'method and status group',
    filters: { method: 'POST', statusGroup: '2xx' },
    matches: (e) => e.content.method === 'POST' && statusGroup(e) === 2,
  },
  { name: 'search', filters: { search: 'orders' }, matches: (e) => e.content.uri.includes('orders') },
  { name: 'user', filters: { userIdentifier: 'alice' }, matches: (e) => e.userIdentifier === 'alice' },
  {
    name: 'user and method',
    filters: { userIdentifier: 'alice', method: 'GET' },
    matches: (e) => e.userIdentifier === 'alice' && e.content.method === 'GET',
  },
  {
    name: 'tenant and status group',
    filters: { tenantId: 't1', statusGroup: '5xx' },
    matches: (e) => e.tenantId === 't1' && statusGroup(e) === 5,
  },
  { name: 'matches nothing', filters: { search: 'no-such-text' }, matches: () => false },
];

/** What a correct listing of `type` under `filters` contains, newest first. */
export function expectedUuids(
  all: TelemetryEntry[],
  type: TelemetryEntryType,
  matches: (entry: TelemetryEntry) => boolean,
): string[] {
  return all
    .filter((entry) => entry.type === type && matches(entry))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((entry) => entry.uuid);
}
