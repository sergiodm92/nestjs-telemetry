import { TelemetryRequestInterceptor } from '../src/watchers/request.interceptor';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { DefaultTelemetryUserProvider } from '../src/context/telemetry-user.provider';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { of } from 'rxjs';
import { lastValueFrom } from 'rxjs';

function mockExecutionContext(reqOverrides: any = {}) {
  const req = {
    method: 'GET',
    originalUrl: '/api/users?page=1',
    path: '/api/users',
    query: { page: '1' },
    headers: { 'content-type': 'application/json', host: 'localhost:3000' },
    ip: '127.0.0.1',
    body: { name: 'test' },
    user: undefined,
    ...reqOverrides,
  };
  const res = { statusCode: 200 };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

function mockCallHandler(responseBody: any = { ok: true }) {
  return { handle: () => of(responseBody) };
}

describe('TelemetryRequestInterceptor', () => {
  let storage: InMemoryTelemetryStorage;
  let interceptor: TelemetryRequestInterceptor;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    interceptor = new TelemetryRequestInterceptor(
      storage,
      new DefaultTelemetryUserProvider(),
      ['/health'],
      '/telemetry',
    );
  });

  it('records HTTP request with method, url, status, duration', async () => {
    const ctx = mockExecutionContext();
    const handler = mockCallHandler();
    await lastValueFrom(interceptor.intercept(ctx, handler));

    const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].content.method).toBe('GET');
    expect(entries[0].content.uri).toBe('/api/users');
    expect(entries[0].content.status).toBe(200);
    expect(entries[0].content.duration).toBeDefined();
  });

  it('masks sensitive headers', async () => {
    const ctx = mockExecutionContext({
      headers: { authorization: 'Bearer secret', cookie: 'session=abc', host: 'localhost' },
    });
    await lastValueFrom(interceptor.intercept(ctx, mockCallHandler()));

    const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(entries[0].content.requestHeaders.authorization).toBe('***');
    expect(entries[0].content.requestHeaders.cookie).toBe('***');
  });

  it('skips ignored prefixes', async () => {
    const ctx = mockExecutionContext({ path: '/health' });
    await lastValueFrom(interceptor.intercept(ctx, mockCallHandler()));

    const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(entries).toHaveLength(0);
  });

  it('skips telemetry own requests', async () => {
    const ctx = mockExecutionContext({ path: '/telemetry/api/stats' });
    await lastValueFrom(interceptor.intercept(ctx, mockCallHandler()));

    const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(entries).toHaveLength(0);
  });

  it('truncates large request bodies', async () => {
    const largeBody = { data: 'x'.repeat(20000) };
    const ctx = mockExecutionContext({ body: largeBody });
    await lastValueFrom(interceptor.intercept(ctx, mockCallHandler()));

    const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(entries[0].content.requestBody.length).toBeLessThanOrEqual(10000 + 50);
  });

  it('does not record when storage is disabled', async () => {
    storage.setEnabled(false);
    const ctx = mockExecutionContext();
    await lastValueFrom(interceptor.intercept(ctx, mockCallHandler()));

    const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(entries).toHaveLength(0);
  });
});
