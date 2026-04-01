import { TelemetryContext } from '../src/context/telemetry-context';

describe('TelemetryContext', () => {
  afterEach(() => {
    TelemetryContext.clear();
  });

  it('returns undefined when no context is set', () => {
    expect(TelemetryContext.getBatchId()).toBeUndefined();
  });

  it('stores and retrieves batchId', (done) => {
    TelemetryContext.run({ batchId: 'test-batch-123' }, () => {
      expect(TelemetryContext.getBatchId()).toBe('test-batch-123');
      done();
    });
  });

  it('getOrCreateBatchId creates a UUID when no context exists', () => {
    const id = TelemetryContext.getOrCreateBatchId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stores userIdentifier and tenantId', (done) => {
    TelemetryContext.run(
      { batchId: 'b1', userIdentifier: 'user@test.com', tenantId: 'tenant-1' },
      () => {
        expect(TelemetryContext.getUserIdentifier()).toBe('user@test.com');
        expect(TelemetryContext.getTenantId()).toBe('tenant-1');
        done();
      },
    );
  });

  it('isolates context between async operations', async () => {
    const results: string[] = [];
    await Promise.all([
      new Promise<void>((resolve) => {
        TelemetryContext.run({ batchId: 'batch-a' }, () => {
          setTimeout(() => {
            results.push(TelemetryContext.getBatchId()!);
            resolve();
          }, 10);
        });
      }),
      new Promise<void>((resolve) => {
        TelemetryContext.run({ batchId: 'batch-b' }, () => {
          setTimeout(() => {
            results.push(TelemetryContext.getBatchId()!);
            resolve();
          }, 5);
        });
      }),
    ]);
    expect(results).toContain('batch-a');
    expect(results).toContain('batch-b');
  });
});
