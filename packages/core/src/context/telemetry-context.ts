import { AsyncLocalStorage } from 'node:async_hooks';
import { v4 as uuidv4 } from 'uuid';

export interface TelemetryStore {
  batchId: string;
  userIdentifier?: string;
  tenantId?: string;
}

const storage = new AsyncLocalStorage<TelemetryStore>();

export class TelemetryContext {
  static run<T>(store: TelemetryStore, fn: () => T): T {
    return storage.run(store, fn);
  }

  static getStore(): TelemetryStore | undefined {
    return storage.getStore();
  }

  static getBatchId(): string | undefined {
    return storage.getStore()?.batchId;
  }

  static getUserIdentifier(): string | undefined {
    return storage.getStore()?.userIdentifier;
  }

  static getTenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  }

  static getOrCreateBatchId(): string {
    const existing = storage.getStore()?.batchId;
    if (existing) return existing;
    return uuidv4();
  }

  static clear(): void {
    // AsyncLocalStorage cleans up automatically when the callback exits.
  }
}
