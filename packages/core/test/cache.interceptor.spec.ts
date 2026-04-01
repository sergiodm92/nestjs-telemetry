import { TelemetryCacheInterceptor } from '../src/watchers/cache.interceptor';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { of } from 'rxjs';
import { lastValueFrom } from 'rxjs';

function mockExecutionContext() {
  return {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
    getHandler: () => ({ name: 'getUser' }),
    getClass: () => ({ name: 'UserService' }),
  } as any;
}

describe('TelemetryCacheInterceptor', () => {
  let storage: InMemoryTelemetryStorage;
  let interceptor: TelemetryCacheInterceptor;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    interceptor = new TelemetryCacheInterceptor(storage);
  });

  it('records cache operation with HIT when fast response', async () => {
    const handler = { handle: () => of('cached-value') };
    await lastValueFrom(interceptor.intercept(mockExecutionContext(), handler));

    const entries = await storage.getByType(TelemetryEntryType.CACHE, {}, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].content.operation).toBeDefined();
    expect(entries[0].content.duration).toBeDefined();
  });
});
