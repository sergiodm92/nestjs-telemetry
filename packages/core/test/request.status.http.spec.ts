import request from 'supertest';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import {
  HostExceptionFilter,
  TestApp,
  createTestApp,
  requestEntries,
  sleep,
  waitForRequests,
} from './support/test-app';

/**
 * The request watcher through a real app: routing, pipes, guards, interceptors and exception
 * filters all take part, so the status that gets stored is the one the client actually received.
 */

interface StatusCase {
  name: string;
  method: 'get' | 'post';
  url: string;
  status: number;
}

const STATUS_CASES: StatusCase[] = [
  { name: 'a successful GET', method: 'get', url: '/demo/ok', status: 200 },
  { name: 'a successful POST', method: 'post', url: '/demo/create', status: 201 },
  { name: 'a POST that fails with 400 (Nest had pre-set 201)', method: 'post', url: '/demo/bad', status: 400 },
  { name: 'a 400 raised by a pipe', method: 'get', url: '/demo/items/not-a-number', status: 400 },
  { name: 'a handler that throws NotFoundException', method: 'get', url: '/demo/missing', status: 404 },
  { name: 'a handler that throws an unexpected error', method: 'get', url: '/demo/boom', status: 500 },
];

describe.each([
  ['Nest default exception handling', false],
  ['a host exception filter writing the responses', true],
])('request status with %s', (_label, hostFilter) => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp({ hostFilter });
  });

  afterEach(() => app.close());

  it.each(STATUS_CASES)('stores the status the client received for $name', async ({ method, url, status }) => {
    const res = await request(app.server)[method](url);
    expect(res.status).toBe(status);

    const entries = await waitForRequests(app.storage, 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].content).toMatchObject({
      method: method.toUpperCase(),
      uri: url,
      status,
    });
  });

  it('stores exactly one entry per request, failed or not', async () => {
    for (const { method, url } of STATUS_CASES) await request(app.server)[method](url);

    const entries = await waitForRequests(app.storage, STATUS_CASES.length);

    expect(entries.map((e) => [e.content.uri, e.content.status])).toEqual(
      [...STATUS_CASES].reverse().map(({ url, status }) => [url, status]),
    );
  });

  it('stores one entry for a handler that emits several values', async () => {
    await request(app.server).get('/demo/many').expect(200);

    const entries = await waitForRequests(app.storage, 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].content.status).toBe(200);
  });

  it('lets the dashboard filter by status group now that failures keep their status', async () => {
    for (const { method, url } of STATUS_CASES) await request(app.server)[method](url);
    await waitForRequests(app.storage, STATUS_CASES.length);

    const byGroup = async (statusGroup: string) => {
      const res = await request(app.server)
        .get('/telemetry/api/entries')
        .query({ type: 'REQUEST', statusGroup });
      return { total: res.body.data.total, uris: res.body.data.entries.map((e: any) => e.content.uri).sort() };
    };

    expect(await byGroup('4xx')).toEqual({
      total: 3,
      uris: ['/demo/bad', '/demo/items/not-a-number', '/demo/missing'],
    });
    expect(await byGroup('5xx')).toEqual({ total: 1, uris: ['/demo/boom'] });
    expect(await byGroup('2xx')).toEqual({ total: 2, uris: ['/demo/create', '/demo/ok'] });
  });

  it('keeps the batch id shared by the request, the exception it raised and the related-entries view', async () => {
    await request(app.server).get('/demo/boom').expect(500);

    const [entry] = await waitForRequests(app.storage, 1);
    const exceptions = await app.storage.getByType(TelemetryEntryType.EXCEPTION, {}, 0, 10);
    expect(exceptions).toHaveLength(1);
    expect(entry.batchId).toBeTruthy();
    expect(exceptions[0].batchId).toBe(entry.batchId);

    const related = await request(app.server).get(`/telemetry/api/entries/${entry.uuid}/related`);
    expect(related.body.data.map((e: any) => e.type).sort()).toEqual(['EXCEPTION', 'REQUEST']);
  });

  it('does not record the telemetry routes themselves', async () => {
    await request(app.server).get('/telemetry').expect(200);
    await request(app.server).get('/telemetry/api/stats').expect(200);
    await request(app.server).get('/telemetry/api/entries').query({ type: 'REQUEST' }).expect(200);
    await request(app.server).get('/demo/ok').expect(200);

    const entries = await waitForRequests(app.storage, 1);

    expect(entries.map((e) => e.content.uri)).toEqual(['/demo/ok']);
  });

  // Guards run before interceptors and an unmatched route never reaches one, so neither request
  // ever gets a watcher. This is a documented limitation, not something to fix here.
  it('does not see requests rejected by a guard or matching no route (documented limitation)', async () => {
    await request(app.server).get('/demo/guarded').expect(403);
    await request(app.server).get('/demo/no-such-route').expect(404);
    await request(app.server).get('/demo/ok').expect(200);

    const entries = await waitForRequests(app.storage, 1);

    expect(entries.map((e) => e.content.uri)).toEqual(['/demo/ok']);
  });
});

describe('request status with a host exception filter', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp({ hostFilter: true });
  });

  afterEach(() => app.close());

  it('stores a status only the filter knows about', async () => {
    // DomainConflictError means nothing to Nest; the host's filter turns it into a 409.
    await request(app.server).get('/demo/conflict').expect(409);

    const [entry] = await waitForRequests(app.storage, 1);

    expect(entry.content.status).toBe(409);
  });

  it('measures the duration up to the moment the filter finished writing the response', async () => {
    HostExceptionFilter.delayMs = 80;
    await request(app.server).get('/demo/boom').expect(500);

    const [entry] = await waitForRequests(app.storage, 1);

    expect(entry.content.status).toBe(500);
    expect(entry.content.duration).toBeGreaterThanOrEqual(70);
  });
});

describe('request status behind a global prefix', () => {
  it('keeps ignoring its own traffic when externalBasePath is the real, prefixed path', async () => {
    const app = await createTestApp({
      globalPrefix: 'api/v1',
      telemetry: { externalBasePath: '/api/v1/telemetry' },
    });
    try {
      await request(app.server).get('/api/v1/telemetry').expect(200);
      await request(app.server).get('/api/v1/telemetry/api/stats').expect(200);
      await request(app.server).get('/api/v1/demo/missing').expect(404);

      const entries = await waitForRequests(app.storage, 1);

      expect(entries.map((e) => [e.content.uri, e.content.status])).toEqual([['/api/v1/demo/missing', 404]]);
    } finally {
      await app.close();
    }
  });

  // The README's documented consequence of leaving externalBasePath out.
  it('records its own traffic as requests without externalBasePath', async () => {
    const app = await createTestApp({ globalPrefix: 'api/v1' });
    try {
      await request(app.server).get('/api/v1/telemetry/api/stats').expect(200);

      const entries = await waitForRequests(app.storage, 1);

      expect(entries.map((e) => e.content.uri)).toEqual(['/api/v1/telemetry/api/stats']);
    } finally {
      await app.close();
    }
  });
});

describe('recording', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(() => app.close());

  it('stops when switched off and resumes when switched back on', async () => {
    await request(app.server).post('/telemetry/api/toggle').expect(201).expect((res) => {
      expect(res.body.data).toEqual({ enabled: false });
    });
    await request(app.server).get('/demo/ok').expect(200);
    await sleep(50);
    expect(await requestEntries(app.storage)).toHaveLength(0);

    await request(app.server).post('/telemetry/api/toggle').expect(201);
    await request(app.server).get('/demo/ok').expect(200);
    expect(await waitForRequests(app.storage, 1)).toHaveLength(1);
  });
});
