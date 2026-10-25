import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import request from 'supertest';
import { TelemetryController } from '../src/controller/telemetry.controller';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { seedEntries } from './support/entries';
import { controllerRoutes } from './support/routes';
import { TestApp, createTestApp } from './support/test-app';

/**
 * The dashboard (src/dashboard/index.html) and the controller are written separately and meet
 * only over HTTP, so nothing in the type system stops them drifting apart: the dashboard once
 * called /telemetry/api/* while the controller served /telemetry/*, and read response shapes the
 * controller did not produce. These tests run the page's own script against a real app, so what
 * the dashboard asks for and how it reads the answer are checked against what the controller
 * actually serves.
 */

const DASHBOARD_HTML = path.join(__dirname, '..', 'src', 'dashboard', 'index.html');

function dashboardScript(): string {
  const html = fs.readFileSync(DASHBOARD_HTML, 'utf-8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const script = scripts.find((source) => source.includes('function telemetry()'));
  if (!script) throw new Error('index.html no longer has an inline script defining telemetry()');
  return script;
}

interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  status: number;
}

type Dashboard = Record<string, any>;

/**
 * Evaluates the page's script the way a browser would (a `window.location`, a `fetch`) and
 * returns the Alpine component object, with every fetch answered by the real app over HTTP.
 * `settled()` waits for the requests the page fires without awaiting them (a refresh after a
 * clear, say), so none is still in flight when a test ends.
 */
function loadDashboard(
  server: any,
  location: { pathname: string; search?: string },
  windowExtras: Record<string, unknown> = {},
) {
  const calls: RecordedCall[] = [];
  const inFlight = new Set<Promise<unknown>>();

  const fetchViaHttp = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const method = (init.method ?? 'GET').toLowerCase();
    const headers = init.headers ?? {};
    const answered = (async () => {
      let call = (request(server) as any)[method](url);
      for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
      const res = await call;
      calls.push({ method: method.toUpperCase(), url, headers, status: res.status });
      return { status: res.status, json: async () => res.body };
    })();
    inFlight.add(answered);
    void answered.finally(() => inFlight.delete(answered));
    return answered;
  };
  const settled = async () => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
  };

  const sandbox: Record<string, any> = {
    window: { location: { pathname: location.pathname, search: location.search ?? '' }, ...windowExtras },
    fetch: fetchViaHttp,
    console,
    URLSearchParams,
    encodeURIComponent,
    navigator: {},
    // The page schedules refreshes and message timeouts; none of that is under test.
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${dashboardScript()}\nthis.component = telemetry();`, sandbox);

  return { dashboard: sandbox.component as Dashboard, calls, settled };
}

/** Every dashboard method that talks to the API, and how to make it do so. */
const API_CALLERS: Record<string, (dashboard: Dashboard) => Promise<unknown>> = {
  fetchStats: (d) => d.fetchStats(),
  fetchRecentRequests: (d) => d.fetchRecentRequests(),
  fetchFilters: (d) => d.fetchFilters(),
  fetchEntries: (d) => {
    d.currentView = 'requests';
    return d.fetchEntries();
  },
  fetchRelated: (d) => d.fetchRelated('req-59'),
  toggleEnabled: (d) => d.toggleEnabled(),
  clearEntries: (d) => {
    d.currentView = 'requests';
    return d.clearEntries();
  },
  pruneEntries: (d) => d.pruneEntries(),
};

async function seed(app: TestApp) {
  for (const entry of seedEntries()) await app.storage.store(entry);
  // A second entry in the batch of req-59, for the related-entries view.
  await app.storage.store({
    uuid: 'exc-59',
    type: TelemetryEntryType.EXCEPTION,
    createdAt: new Date('2026-01-01T00:00:59.500Z'),
    batchId: 'batch-59',
    content: { class: 'Error', message: 'boom' },
    userIdentifier: '',
    tenantId: '',
    tags: [],
  });
}

describe('dashboard page', () => {
  it('makes every API call through one helper, so none can skip the base path or the token', () => {
    expect(dashboardScript().match(/\bfetch\(/g)).toHaveLength(1);
  });

  it('exercises, below, every method that calls the API', () => {
    const { dashboard } = loadDashboard(undefined, { pathname: '/telemetry' });
    const callers = Object.entries(Object.getOwnPropertyDescriptors(dashboard))
      .filter(([, descriptor]) => typeof descriptor.value === 'function' && String(descriptor.value).includes('this.api('))
      .map(([name]) => name)
      .sort();

    expect(callers).toEqual(Object.keys(API_CALLERS).sort());
  });
});

describe('dashboard against the controller', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp();
    await seed(app);
  });

  afterEach(() => app.close());

  it('only asks for routes the controller declares, with the method the route is declared for', async () => {
    const { dashboard, calls, settled } = loadDashboard(app.server, { pathname: '/telemetry' });
    for (const call of Object.values(API_CALLERS)) await call(dashboard);
    await settled();

    const declared = controllerRoutes(TelemetryController).map((route) => ({
      method: route.method,
      path: new RegExp(`^/telemetry${route.path.replace(/:[^/]+/g, '[^/]+')}$`),
    }));

    expect(calls.length).toBeGreaterThanOrEqual(Object.keys(API_CALLERS).length);
    for (const call of calls) {
      const pathname = call.url.split('?')[0];
      const known = declared.some((route) => route.method === call.method && route.path.test(pathname));
      expect({ call: `${call.method} ${pathname}`, known }).toEqual({ call: `${call.method} ${pathname}`, known: true });
      expect([200, 201]).toContain(call.status);
    }
  });

  it('reads the stats, the recent requests and the filter options the controller produces', async () => {
    const { dashboard } = loadDashboard(app.server, { pathname: '/telemetry' });

    await dashboard.fetchStats();
    await dashboard.fetchRecentRequests();
    await dashboard.fetchFilters();

    expect(dashboard.stats).toMatchObject({ REQUEST: 60, LOG: 5, EXCEPTION: 1 });
    expect(dashboard.recentRequests).toHaveLength(10);
    expect(dashboard.recentRequests[0].uuid).toBe('req-59');
    expect(dashboard.filterOptions.users).toEqual([
      { id: 'alice', name: 'alice' },
      { id: 'bob', name: 'bob' },
    ]);
    expect(dashboard.filterOptions.tenants).toEqual([{ id: 't1', name: 't1' }]);
  });

  it('lists entries and paginates from the total the controller reports', async () => {
    const { dashboard } = loadDashboard(app.server, { pathname: '/telemetry' });
    dashboard.currentView = 'requests';
    dashboard.pageSize = 25;

    await dashboard.fetchEntries();
    expect(dashboard.entries).toHaveLength(25);
    expect(dashboard.totalEntries).toBe(60);

    dashboard.currentPage = 2;
    await dashboard.fetchEntries();
    expect(dashboard.entries).toHaveLength(10);
    expect(dashboard.totalEntries).toBe(60);

    dashboard.currentPage = 0;
    dashboard.filterMethod = 'POST';
    dashboard.filterStatusGroup = '2xx';
    await dashboard.fetchEntries();
    expect(dashboard.totalEntries).toBe(10);
    expect(dashboard.entries.every((e: any) => e.content.method === 'POST')).toBe(true);
  });

  it('lists the entries related to the one that was selected', async () => {
    const { dashboard } = loadDashboard(app.server, { pathname: '/telemetry' });

    await dashboard.fetchRelated('req-59');

    expect(dashboard.relatedEntries.map((e: any) => e.uuid).sort()).toEqual(['exc-59', 'req-59']);
  });

  it('shows the recording state the toggle route answers with', async () => {
    const { dashboard } = loadDashboard(app.server, { pathname: '/telemetry' });
    expect(dashboard.enabled).toBe(true);

    await dashboard.toggleEnabled();
    expect(dashboard.enabled).toBe(false);
    expect(app.storage.isEnabled()).toBe(false);

    await dashboard.toggleEnabled();
    expect(dashboard.enabled).toBe(true);
    expect(app.storage.isEnabled()).toBe(true);
  });

  it('clears the entries of the view it is showing', async () => {
    const { dashboard, settled } = loadDashboard(app.server, { pathname: '/telemetry' });
    dashboard.currentView = 'requests';
    await dashboard.fetchEntries();

    await dashboard.clearEntries();
    await settled();

    const stats = await app.storage.getStats();
    expect(stats[TelemetryEntryType.REQUEST]).toBe(0);
    expect(stats[TelemetryEntryType.LOG]).toBe(5);
    expect(dashboard.entries).toEqual([]);
  });

  it('reports how many entries a prune removed', async () => {
    await app.storage.clear();
    const day = 24 * 60 * 60 * 1000;
    for (const [uuid, age] of [['old-1', 3 * day], ['old-2', 2 * day], ['fresh', 0]] as const) {
      await app.storage.store({
        ...seedEntries()[0],
        uuid,
        createdAt: new Date(Date.now() - age),
      });
    }
    const { dashboard, settled } = loadDashboard(app.server, { pathname: '/telemetry' });

    await dashboard.pruneEntries();
    await settled();

    expect(dashboard.pruneResult).toBe('Pruned 2 entries');
    expect((await app.storage.getStats())[TelemetryEntryType.REQUEST]).toBe(1);
  });
});

describe('dashboard base path', () => {
  const baseFor = (pathname: string, windowExtras: Record<string, unknown> = {}) =>
    loadDashboard(undefined, { pathname }, windowExtras).dashboard.apiBase;

  it('is the path the page was served from, plus /api', () => {
    expect(baseFor('/telemetry')).toBe('/telemetry/api');
    expect(baseFor('/telemetry/')).toBe('/telemetry/api');
    expect(baseFor('/dev/telemetry')).toBe('/dev/telemetry/api');
    expect(baseFor('/api/v1/telemetry/')).toBe('/api/v1/telemetry/api');
  });

  it('can be pinned by the page that embeds it', () => {
    expect(baseFor('/somewhere/else', { __TELEMETRY_BASE_PATH__: '/proxied/telemetry' })).toBe(
      '/proxied/telemetry/api',
    );
  });

  it('works under a custom basePath', async () => {
    const custom = await createTestApp({ async: true, telemetry: { basePath: '/dev/telemetry' } });
    try {
      await seed(custom);
      const { dashboard } = loadDashboard(custom.server, { pathname: '/dev/telemetry' });

      await dashboard.fetchStats();

      expect(dashboard.stats.REQUEST).toBe(60);
    } finally {
      await custom.close();
    }
  });

  it('works behind a global prefix', async () => {
    const prefixed = await createTestApp({
      globalPrefix: 'api/v1',
      telemetry: { externalBasePath: '/api/v1/telemetry' },
    });
    try {
      await seed(prefixed);
      const { dashboard } = loadDashboard(prefixed.server, { pathname: '/api/v1/telemetry' });

      await dashboard.fetchStats();

      expect(dashboard.stats.REQUEST).toBe(60);
    } finally {
      await prefixed.close();
    }
  });
});

describe('dashboard with an access token', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp({ telemetry: { accessToken: 'secret' } });
    await seed(app);
  });

  afterEach(() => app.close());

  it('sends the token it was opened with on every API call', async () => {
    const { dashboard, calls, settled } = loadDashboard(app.server, {
      pathname: '/telemetry',
      search: '?token=secret',
    });

    await dashboard.fetchStats();
    expect(dashboard.stats.REQUEST).toBe(60);

    for (const call of Object.values(API_CALLERS)) await call(dashboard);
    await settled();

    expect(calls.length).toBeGreaterThanOrEqual(Object.keys(API_CALLERS).length);
    expect(calls.map((call) => call.headers['x-telemetry-token'])).toEqual(calls.map(() => 'secret'));
    expect(calls.map((call) => call.status).every((status) => status === 200 || status === 201)).toBe(true);
  });

  it('shows nothing, and does not break, when the page was opened without the token', async () => {
    const { dashboard, calls } = loadDashboard(app.server, { pathname: '/telemetry' });

    await dashboard.fetchStats();
    await dashboard.fetchRecentRequests();

    expect(calls.map((call) => call.status)).toEqual([403, 403]);
    expect(calls.every((call) => !('x-telemetry-token' in call.headers))).toBe(true);
    expect(dashboard.stats).toEqual({});
    expect(dashboard.recentRequests).toEqual([]);
  });
});
