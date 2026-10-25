import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { TelemetryRequestInterceptor } from '../src/watchers/request.interceptor';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { DefaultTelemetryUserProvider } from '../src/context/telemetry-user.provider';
import { TelemetryContext } from '../src/context/telemetry-context';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { Observable, from, of, throwError } from 'rxjs';
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

  it('records a global-prefix dashboard request when constructed with the bare basePath (documents the mismatch)', async () => {
    // Same interceptor as above, built with just '/telemetry'. A consumer using
    // app.setGlobalPrefix('api/v1') has real requests land on '/api/v1/telemetry/...', which
    // does not start with '/telemetry' — so self-exclusion fails to recognize its own traffic.
    const ctx = mockExecutionContext({ path: '/api/v1/telemetry/api/stats' });
    await lastValueFrom(interceptor.intercept(ctx, mockCallHandler()));

    const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(entries).toHaveLength(1);
  });

  it('honors externalBasePath for self-exclusion under a global prefix', async () => {
    const prefixedInterceptor = new TelemetryRequestInterceptor(
      storage,
      new DefaultTelemetryUserProvider(),
      ['/health'],
      '/api/v1/telemetry',
    );
    const ctx = mockExecutionContext({ path: '/api/v1/telemetry/api/stats' });
    await lastValueFrom(prefixedInterceptor.intercept(ctx, mockCallHandler()));

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

  describe('request body redaction', () => {
    async function recordedContent(req: any): Promise<any> {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext(req), mockCallHandler()),
      );
      const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
      return entries[0].content;
    }

    async function recordedBody(body: any): Promise<string> {
      return (await recordedContent({ body })).requestBody;
    }

    it('masks sensitive fields at any depth, arrays included, and keeps the rest', async () => {
      const stored = JSON.parse(
        await recordedBody({
          email: 'ana@example.com',
          password: 'hunter2',
          profile: { newPassword: 'p1', refresh_token: 't1', name: 'Ana' },
          items: [{ 'X-Api-Key': 'k1', sku: 'a-1' }],
          clientSecret: 's1',
        }),
      );

      expect(stored).toEqual({
        email: 'ana@example.com',
        password: '***',
        profile: { newPassword: '***', refresh_token: '***', name: 'Ana' },
        items: [{ 'X-Api-Key': '***', sku: 'a-1' }],
        clientSecret: '***',
      });
    });

    it('keeps a Date field readable instead of dropping it', async () => {
      const stored = JSON.parse(
        await recordedBody({ at: new Date('2026-10-25T03:00:00.000Z'), password: 'x' }),
      );

      expect(stored).toEqual({ at: '2026-10-25T03:00:00.000Z', password: '***' });
    });

    it('masks a JSON document that arrives as a string', async () => {
      const stored = JSON.parse(await recordedBody('{"password":"hunter2","a":1}'));

      expect(stored).toEqual({ password: '***', a: 1 });
    });

    it.each([
      'password',
      'passwd',
      'passcode',
      'secret',
      'accessToken',
      'apiKey',
      'api key',
      'api.key',
      'authorization',
      'cardNumber',
      'card number',
      'cvv',
      'cvc',
      'privateKey',
      'credentials',
      'twoFactorCode',
      'code',
      'otp',
      'pin',
      'pwd',
      'pass',
      'jwt',
      'auth',
      'bearer',
      'cookie',
    ])('masks a field called %s', async (field) => {
      const stored = JSON.parse(await recordedBody({ [field]: 'value-to-hide' }));

      expect(stored).toEqual({ [field]: '***' });
    });

    it.each(['statusCode', 'postcode', 'barcode', 'discountCode', 'shipping', 'pinned', 'passenger'])(
      'keeps a field called %s, whose name only contains a short sensitive one',
      async (field) => {
        const stored = JSON.parse(await recordedBody({ [field]: 'visible' }));

        expect(stored).toEqual({ [field]: 'visible' });
      },
    );

    it('replaces a text body that names a sensitive field', async () => {
      expect(await recordedBody('password=hunter2&email=ana@example.com')).toBe('***');
    });

    it('keeps a text body that names none', async () => {
      expect(await recordedBody('hello there')).toBe('hello there');
    });

    it('masks the value of a sensitive query parameter and keeps the rest as written', async () => {
      const content = await recordedContent({
        originalUrl: '/api/auth/logout?refreshToken=abc.def&page=1&x%2Dapi%2Dkey=k1&flag',
      });

      expect(content.queryString).toBe('refreshToken=***&page=1&x%2Dapi%2Dkey=***&flag');
    });

    it('masks sensitive request headers by name, not only the three well known ones', async () => {
      const content = await recordedContent({
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer abc',
          cookie: 'sid=1',
          'x-api-key': 'k1',
          'x-auth-token': 't1',
          'proxy-authorization': 'Basic zzz',
          'x-request-id': 'r-1',
        },
      });

      expect(content.requestHeaders).toEqual({
        'content-type': 'application/json',
        authorization: '***',
        cookie: '***',
        'x-api-key': '***',
        'x-auth-token': '***',
        'proxy-authorization': '***',
        'x-request-id': 'r-1',
      });
    });

    it('does not store the bytes of a raw body', async () => {
      const stored = await recordedBody(Buffer.from('{"password":"hunter2"}'));

      expect(stored).toBe('[binary body omitted]');
    });

    it('records nothing, and does not throw, when the body cannot be serialised', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const body: any = { password: 'hunter2' };
      body.self = body;

      await expect(
        lastValueFrom(interceptor.intercept(mockExecutionContext({ body }), mockCallHandler())),
      ).resolves.toBeDefined();

      expect(await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10)).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('hunter2');
      warn.mockRestore();
    });

    it('never lets a secret through when the body is truncated', async () => {
      const stored = await recordedBody({ password: 'hunter2', data: 'x'.repeat(20000) });

      expect(stored).not.toContain('hunter2');
      expect(stored.length).toBeLessThanOrEqual(10000 + 50);
    });
  });

  it('does not record when storage is disabled', async () => {
    storage.setEnabled(false);
    const ctx = mockExecutionContext();
    await lastValueFrom(interceptor.intercept(ctx, mockCallHandler()));

    const entries = await storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
    expect(entries).toHaveLength(0);
  });
});

// A real response announces when it has been sent; the plain-object responses above cannot, so
// they exercise the fallback. These tests drive the same events Node emits.
describe('TelemetryRequestInterceptor: recording when the response ends', () => {
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

  afterEach(() => jest.restoreAllMocks());

  function mockResponse(statusCode = 201) {
    return Object.assign(new EventEmitter(), { statusCode });
  }

  function contextFor(res: any, reqOverrides: any = {}) {
    const req = {
      method: 'POST',
      originalUrl: '/orders',
      path: '/orders',
      headers: {},
      ip: '127.0.0.1',
      body: {},
      ...reqOverrides,
    };
    return {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }

  const stored = () => storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10);
  const okHandler = { handle: () => of({ ok: true }) };

  it('records nothing until the response has ended', async () => {
    const res = mockResponse();
    await lastValueFrom(interceptor.intercept(contextFor(res), okHandler));
    expect(await stored()).toHaveLength(0);

    res.emit('finish');
    expect(await stored()).toHaveLength(1);
  });

  it('stores the status the response ended with, not the success status set before the handler ran', async () => {
    // Nest pre-sets 201 for a POST; the host's exception filter writes the real status afterwards.
    const res = mockResponse(201);
    const failing = { handle: () => throwError(() => new Error('invalid')) };
    await expect(lastValueFrom(interceptor.intercept(contextFor(res), failing))).rejects.toThrow('invalid');

    res.statusCode = 400;
    res.emit('finish');

    const [entry] = await stored();
    expect(entry.content.status).toBe(400);
  });

  it('stores a changed status for a request that succeeded too (a redirect written after the handler)', async () => {
    const res = mockResponse(200);
    await lastValueFrom(interceptor.intercept(contextFor(res, { method: 'GET' }), okHandler));

    res.statusCode = 302;
    res.emit('finish');

    const [entry] = await stored();
    expect(entry.content.status).toBe(302);
    expect(entry.content.method).toBe('GET');
  });

  it('records exactly once when the response finishes and then closes', async () => {
    const res = mockResponse();
    await lastValueFrom(interceptor.intercept(contextFor(res), okHandler));
    expect(await stored()).toHaveLength(0);

    res.emit('finish');
    res.emit('close');

    expect(await stored()).toHaveLength(1);
  });

  it('records on close when the connection ended before the response finished', async () => {
    const res = mockResponse();
    await lastValueFrom(interceptor.intercept(contextFor(res), okHandler));
    expect(await stored()).toHaveLength(0);

    res.emit('close');

    expect(await stored()).toHaveLength(1);
  });

  it('records one entry per request when the handler emits several values', async () => {
    const res = mockResponse(200);
    const emitsThrice = { handle: () => from([1, 2, 3]) };
    await lastValueFrom(interceptor.intercept(contextFor(res), emitsThrice));

    res.emit('finish');

    expect(await stored()).toHaveLength(1);
  });

  it('measures the duration up to the end of the response', async () => {
    const now = jest.spyOn(Date, 'now');
    const res = mockResponse(500);

    now.mockReturnValue(1_000);
    const observable = interceptor.intercept(contextFor(res), okHandler);
    now.mockReturnValue(1_010); // the handler is done...
    await lastValueFrom(observable);
    now.mockReturnValue(1_250); // ...but the exception filter was slow to write the response
    res.emit('finish');

    const [entry] = await stored();
    expect(entry.content.duration).toBe(250);
  });

  it('keeps the batch id of the request on its entry', async () => {
    const res = mockResponse(200);
    let seenWhileHandling: string | undefined;
    const handler = {
      handle: () =>
        new Observable((subscriber) => {
          seenWhileHandling = TelemetryContext.getBatchId();
          subscriber.next(1);
          subscriber.complete();
        }),
    };
    await lastValueFrom(interceptor.intercept(contextFor(res), handler));
    res.emit('finish');

    const [entry] = await stored();
    expect(seenWhileHandling).toBeDefined();
    expect(entry.batchId).toBe(seenWhileHandling);
  });

  it('leaves its own base path and ignored prefixes alone: nothing is watched or recorded', async () => {
    for (const path of ['/telemetry', '/telemetry/api/stats', '/health']) {
      const res = mockResponse(200);
      await lastValueFrom(interceptor.intercept(contextFor(res, { path }), okHandler));
      expect(res.listenerCount('finish')).toBe(0);
      expect(res.listenerCount('close')).toBe(0);
      res.emit('finish');
    }
    expect(await stored()).toHaveLength(0);
  });

  it('does not record a request whose recording was switched off before it ended', async () => {
    const res = mockResponse(200);
    await lastValueFrom(interceptor.intercept(contextFor(res), okHandler));

    storage.setEnabled(false);
    res.emit('finish');

    expect(await stored()).toHaveLength(0);
  });

  it('never throws out of the response event when recording fails', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(storage, 'store').mockImplementation(() => {
      throw new Error('storage down');
    });
    const res = mockResponse(200);

    return lastValueFrom(interceptor.intercept(contextFor(res), okHandler)).then(() => {
      // A throw from a 'finish' listener would be an uncaught exception that kills the host app.
      expect(() => res.emit('finish')).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('storage down'));
    });
  });

  it('watches the Node response that a Fastify-style reply keeps in .raw', async () => {
    const raw = mockResponse(404);
    const reply = { statusCode: 404, raw };
    await lastValueFrom(interceptor.intercept(contextFor(reply, { method: 'GET' }), okHandler));
    expect(await stored()).toHaveLength(0);

    raw.emit('finish');

    const [entry] = await stored();
    expect(entry.content.status).toBe(404);
  });

  it('falls back to recording when the handler settles if the response cannot be watched, still once', async () => {
    const unwatchable = { statusCode: 200 };
    const emitsTwice = { handle: () => from([1, 2]) };
    await lastValueFrom(interceptor.intercept(contextFor(unwatchable), emitsTwice));

    expect(await stored()).toHaveLength(1);
  });
});
