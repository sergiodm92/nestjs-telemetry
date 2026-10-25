import request from 'supertest';
import { TelemetryController } from '../src/controller/telemetry.controller';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { TelemetryStorage } from '../src/storage/telemetry-storage.interface';
import { FILTER_CASES, expectedUuids, seedEntries } from './support/entries';
import { controllerRoutes } from './support/routes';
import { TestApp, createTestApp } from './support/test-app';

/**
 * These tests talk to a real Nest app over HTTP, because the bugs they guard against (routes
 * mounted where the dashboard does not look, a guard that never matches the real path) are
 * invisible to tests that call controller or guard methods directly.
 */

/** Every JSON route, as `METHOD path-below-basePath`. The dashboard page itself is GET {basePath}. */
const JSON_ROUTES = [
  'GET /api/entries',
  'GET /api/entries/:uuid',
  'GET /api/entries/:uuid/related',
  'GET /api/filters',
  'GET /api/stats',
  'GET /api/status',
  'GET /api/tags',
  'GET /api/memory',
  // Mutating routes last: they change what the ones above would answer.
  'POST /api/toggle',
  'POST /api/flush',
  'POST /api/prune',
  'POST /api/prune/expired',
  'DELETE /api/entries',
];

const SEEDED_UUID = 'req-59';

/** What a route answers when it is served: Nest answers 201 to a POST unless told otherwise. */
const servedStatus = (route: string): number => (route.startsWith('POST ') ? 201 : 200);

function callRoute(server: any, base: string, route: string, extra: { token?: string; viaHeader?: boolean } = {}) {
  const [method, routePath] = route.split(' ');
  const needsType = routePath === '/api/entries';
  const url = `${base}${routePath.replace(':uuid', SEEDED_UUID)}${needsType ? '?type=LOG' : ''}`;
  const call = (request(server) as any)[method.toLowerCase()](url);
  if (extra.token) {
    return extra.viaHeader ? call.set('x-telemetry-token', extra.token) : call.query({ token: extra.token });
  }
  return call;
}

async function seed(storage: TelemetryStorage) {
  for (const entry of seedEntries()) await storage.store(entry);
}

describe('routes', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp();
    await seed(app.storage);
  });

  afterEach(() => app.close());

  it('serves the dashboard page at the base path', async () => {
    for (const url of ['/telemetry', '/telemetry/']) {
      const res = await request(app.server).get(url);
      expect(res.status).toBe(200);
      expect(res.type).toBe('text/html');
      expect(res.text).toContain('<title>NestJS Telemetry</title>');
      expect(res.text).toContain('function telemetry()');
    }
  });

  it('serves every JSON route under {basePath}/api', async () => {
    const answers: Record<string, unknown> = {};
    for (const route of JSON_ROUTES) {
      const res = await callRoute(app.server, '/telemetry', route);
      answers[route] = { status: res.status, success: res.body.success };
    }

    expect(answers).toEqual(
      Object.fromEntries(JSON_ROUTES.map((route) => [route, { status: servedStatus(route), success: true }])),
    );
  });

  it('no longer answers on the old un-prefixed JSON paths', async () => {
    const statuses: Record<string, number> = {};
    for (const route of JSON_ROUTES) {
      const res = await callRoute(app.server, '/telemetry', route.replace(' /api', ' '));
      statuses[route] = res.status;
    }

    expect(statuses).toEqual(Object.fromEntries(JSON_ROUTES.map((route) => [route, 404])));
  });

  it('is covered here route for route: the controller declares exactly the JSON routes above plus the page', () => {
    const declared = controllerRoutes(TelemetryController).map((r) => `${r.method} ${r.path}`);

    expect(declared.filter((route) => !route.includes(' /api/'))).toEqual(['GET /']);
    expect(declared.filter((route) => route.includes(' /api/')).sort()).toEqual([...JSON_ROUTES].sort());
  });
});

describe('routes under other mount points', () => {
  it('follows a custom basePath registered through forRootAsync', async () => {
    const app = await createTestApp({
      async: true,
      telemetry: { basePath: '/dev/telemetry' },
    });
    try {
      const statuses = {
        page: (await request(app.server).get('/dev/telemetry')).status,
        json: (await request(app.server).get('/dev/telemetry/api/stats')).status,
        oldJson: (await request(app.server).get('/dev/telemetry/stats')).status,
        defaultBasePath: (await request(app.server).get('/telemetry/api/stats')).status,
      };
      expect(statuses).toEqual({ page: 200, json: 200, oldJson: 404, defaultBasePath: 404 });
    } finally {
      await app.close();
    }
  });

  it('sits behind a global prefix like any other route', async () => {
    const app = await createTestApp({ globalPrefix: 'api/v1' });
    try {
      const statuses = {
        page: (await request(app.server).get('/api/v1/telemetry')).status,
        json: (await request(app.server).get('/api/v1/telemetry/api/stats')).status,
        unprefixed: (await request(app.server).get('/telemetry/api/stats')).status,
      };
      expect(statuses).toEqual({ page: 200, json: 200, unprefixed: 404 });
    } finally {
      await app.close();
    }
  });
});

describe.each(['memory', 'sqlite'] as const)('GET api/entries on %s storage', (kind) => {
  let app: TestApp;
  const all = seedEntries();

  beforeEach(async () => {
    app = await createTestApp({ telemetry: { storage: kind } });
    await seed(app.storage);
  });

  afterEach(() => app.close());

  it('answers { entries, total } inside the usual envelope', async () => {
    const res = await request(app.server).get('/telemetry/api/entries?type=REQUEST&page=0&size=10');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'ok' });
    expect(Object.keys(res.body.data).sort()).toEqual(['entries', 'total']);
    expect(res.body.data.entries).toHaveLength(10);
    expect(res.body.data.total).toBe(60);
  });

  it('keeps total at the number of matching entries on every page, whatever the page holds', async () => {
    const lengths: number[] = [];
    const totals: number[] = [];
    for (const page of [0, 1, 2, 3]) {
      const res = await request(app.server).get('/telemetry/api/entries').query({ type: 'REQUEST', page, size: 25 });
      lengths.push(res.body.data.entries.length);
      totals.push(res.body.data.total);
    }

    expect(lengths).toEqual([25, 25, 10, 0]);
    expect(totals).toEqual([60, 60, 60, 60]);
  });

  it('counts each type on its own', async () => {
    const res = await request(app.server).get('/telemetry/api/entries').query({ type: 'LOG', size: 2 });

    expect(res.body.data.entries).toHaveLength(2);
    expect(res.body.data.total).toBe(5);
  });

  it.each(FILTER_CASES)('total and pages follow the filters: $name', async ({ filters, matches }) => {
    const expected = expectedUuids(all, TelemetryEntryType.REQUEST, matches);
    const size = 7;

    const pages: string[][] = [];
    const totals = new Set<number>();
    for (let page = 0; ; page++) {
      const res = await request(app.server)
        .get('/telemetry/api/entries')
        .query({ type: 'REQUEST', page, size, ...filters });
      totals.add(res.body.data.total);
      if (res.body.data.entries.length === 0) break;
      pages.push(res.body.data.entries.map((e: { uuid: string }) => e.uuid));
    }

    expect([...totals]).toEqual([expected.length]);
    for (const page of pages.slice(0, -1)) expect(page).toHaveLength(size);
    expect(pages.flat()).toEqual(expected);
  });
});

describe('access token', () => {
  const token = 'secret';
  const PAGE_AND_JSON = ['GET /', ...JSON_ROUTES];

  /** Status of every route (the page plus each JSON route) for one way of presenting the token. */
  async function statuses(app: TestApp, base: string, extra?: { token?: string; viaHeader?: boolean }) {
    const result: Record<string, number> = {};
    for (const route of PAGE_AND_JSON) {
      const res = await callRoute(app.server, base, route === 'GET /' ? 'GET ' : route, extra);
      result[route] = res.status;
    }
    return result;
  }

  const refused = Object.fromEntries(PAGE_AND_JSON.map((route) => [route, 403]));
  const served = Object.fromEntries(PAGE_AND_JSON.map((route) => [route, servedStatus(route)]));

  describe('without a global prefix', () => {
    let app: TestApp;

    beforeEach(async () => {
      app = await createTestApp({ telemetry: { accessToken: token } });
      await seed(app.storage);
    });

    afterEach(() => app.close());

    // Nest answers a guard that returns false with 403 Forbidden.
    it('refuses the page and every JSON route without the token', async () => {
      expect(await statuses(app, '/telemetry')).toEqual(refused);
    });

    it('refuses a wrong token', async () => {
      expect(await statuses(app, '/telemetry', { token: 'nope' })).toEqual(refused);
    });

    it('lets the token through as a query parameter, which is how the page itself is opened', async () => {
      expect(await statuses(app, '/telemetry', { token })).toEqual(served);
    });

    it('lets the token through as the x-telemetry-token header, which is how API clients send it', async () => {
      expect(await statuses(app, '/telemetry', { token, viaHeader: true })).toEqual(served);
    });

    it('does not touch the routes of the host application', async () => {
      expect((await request(app.server).get('/demo/ok')).status).toBe(200);
    });
  });

  describe('behind a global prefix', () => {
    it('is enforced on the real routes when externalBasePath is the real, prefixed path', async () => {
      const app = await createTestApp({
        globalPrefix: 'api/v1',
        telemetry: { accessToken: token, externalBasePath: '/api/v1/telemetry' },
      });
      await seed(app.storage);
      try {
        const base = '/api/v1/telemetry';
        expect(await statuses(app, base)).toEqual(refused);
        expect(await statuses(app, base, { token: 'nope' })).toEqual(refused);
        expect(await statuses(app, base, { token })).toEqual(served);
        expect(await statuses(app, base, { token, viaHeader: true })).toEqual(served);
        expect((await request(app.server).get('/api/v1/demo/ok')).status).toBe(200);
      } finally {
        await app.close();
      }
    });

    // The README says so: without externalBasePath the guard compares the un-prefixed basePath
    // against prefixed requests and silently waves everything through.
    it('is silently not enforced without externalBasePath (documented in the README)', async () => {
      const app = await createTestApp({ globalPrefix: 'api/v1', telemetry: { accessToken: token } });
      await seed(app.storage);
      try {
        expect(await statuses(app, '/api/v1/telemetry')).toEqual(served);
      } finally {
        await app.close();
      }
    });
  });

  describe('with forRootAsync and a custom basePath', () => {
    it('is enforced on the real routes', async () => {
      const app = await createTestApp({
        async: true,
        telemetry: { basePath: '/dev/telemetry', accessToken: token },
      });
      await seed(app.storage);
      try {
        expect(await statuses(app, '/dev/telemetry')).toEqual(refused);
        expect(await statuses(app, '/dev/telemetry', { token, viaHeader: true })).toEqual(served);
      } finally {
        await app.close();
      }
    });
  });
});
