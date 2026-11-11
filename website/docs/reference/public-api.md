---
title: Public API
description: Everything the three packages export, with signatures, what each export is for, and whether you use it directly or the module wires it for you.
---

Legend: **use** = meant to be called or injected by your code; **wired** = the module binds it for you, exported for advanced use; **avoid** = exported, but see the note.

## @nestjs-telemetry/core

### Module and options

| Export | Kind | |
| --- | --- | --- |
| `TelemetryModule` | Dynamic module | **use** |
| `TelemetryModuleOptions` | Interface | **use** |
| `TelemetryWatcherOptions` | Interface | **use** |

```ts
class TelemetryModule {
  static forRoot(options?: Partial<TelemetryModuleOptions>): DynamicModule;
  static forRootAsync(options: {
    useFactory: (...args: any[]) => TelemetryModuleOptions | Promise<TelemetryModuleOptions>;
    inject?: any[];
    imports?: any[];
    basePath?: string;
  }): DynamicModule;
}
```

Options are described in the [Options reference](../configuration/options.md).

### Injection tokens

| Export | Value | Injectable from your modules |
| --- | --- | --- |
| `TELEMETRY_STORAGE` | `'TELEMETRY_STORAGE'` | Yes: the active `TelemetryStorage`. |
| `TELEMETRY_USER_PROVIDER` | `'TELEMETRY_USER_PROVIDER'` | Yes: the `DefaultTelemetryUserProvider` in use. |
| `TELEMETRY_OPTIONS` | `'TELEMETRY_OPTIONS'` | No: the provider exists only inside the module, so injecting it elsewhere fails. |

```ts
constructor(@Inject(TELEMETRY_STORAGE) private readonly storage: TelemetryStorage) {}
```

### Model

```ts
enum TelemetryEntryType {
  REQUEST = 'REQUEST', EXCEPTION = 'EXCEPTION', QUERY = 'QUERY', LOG = 'LOG', SCHEDULE = 'SCHEDULE',
  CACHE = 'CACHE', EVENT = 'EVENT', MAIL = 'MAIL', MODEL = 'MODEL',
}

interface TelemetryEntry {
  uuid: string; type: TelemetryEntryType; createdAt: Date; batchId: string;
  content: Record<string, any>; userIdentifier: string; tenantId: string; tags: string[];
}
```

See [Entry model](../concepts/entry-model.md).

### Storage

| Export | Kind | |
| --- | --- | --- |
| `TelemetryStorage` | Interface | **use** (to read or store entries) |
| `EntryFilters` | Interface | **use** |
| `InMemoryTelemetryStorage` | Class: `new InMemoryTelemetryStorage(maxEntriesPerType = 1000)` | **wired** |
| `SqliteTelemetryStorage` | Class: `new SqliteTelemetryStorage(dbPath: string)`, plus `close()` | **wired** |

```ts
interface EntryFilters {
  userIdentifier?: string; tenantId?: string; method?: string; statusGroup?: string; search?: string;
}

interface TelemetryStorage {
  store(entry: TelemetryEntry): Promise<void>;
  getByType(type: TelemetryEntryType, filters: EntryFilters, page: number, size: number): Promise<TelemetryEntry[]>;
  countByType(type: TelemetryEntryType, filters: EntryFilters): Promise<number>;
  getByUuid(uuid: string): Promise<TelemetryEntry | null>;
  getByBatchId(batchId: string): Promise<TelemetryEntry[]>;
  getStats(): Promise<Record<string, number>>;
  clear(): Promise<void>;
  clearByType(type: TelemetryEntryType): Promise<void>;
  pruneOlderThan(date: Date): Promise<number>;
  getDistinctTags(): Promise<string[]>;
  getDistinctUserIdentifiers(): Promise<string[]>;
  getDistinctTenantIds(): Promise<string[]>;
  getMemoryInfo(): Promise<Record<string, any>>;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  flush(): Promise<void>;
}
```

The contract each method follows is in [Custom storage](./custom-storage.md).

### Context

| Export | Kind | |
| --- | --- | --- |
| `TelemetryContext` | Static class | **use** |
| `TelemetryStore` | Interface: `{ batchId: string; userIdentifier?: string; tenantId?: string }` | **use** |

```ts
class TelemetryContext {
  static run<T>(store: TelemetryStore, fn: () => T): T;
  static getStore(): TelemetryStore | undefined;
  static getBatchId(): string | undefined;
  static getUserIdentifier(): string | undefined;
  static getTenantId(): string | undefined;
  static getOrCreateBatchId(): string;
  static clear(): void; // no-op, kept for compatibility
}
```

See [Batch correlation](../concepts/batch-correlation.md).

### User provider

| Export | Kind | |
| --- | --- | --- |
| `TelemetryUserProvider` | Interface: `getUser(request: any): TelemetryUserInfo \| null` | reference |
| `TelemetryUserInfo` | Interface: `{ identifier: string; tenantId?: string }` | reference |
| `DefaultTelemetryUserProvider` | Class | **wired** |

The module always uses `DefaultTelemetryUserProvider`; there is no option to supply another one.

### Watchers

| Export | Signature | |
| --- | --- | --- |
| `TelemetryMailWatcher` | `record(mail: MailInfo): Promise<void>`; `instrument<T extends object>(target: T, source?: string): T`; `restore(): void`; `isRecording(): boolean` | **use** ([Mail](../watchers/mail.md)) |
| `MailInfo`, `MailAddress`, `MailAddresses` | Types of `record()`'s argument | **use** |
| `TelemetryLogWatcher` | `LoggerService`: `log`, `error(message, trace?, context?)`, `warn`, `debug`, `verbose` | **use** ([Logs](../watchers/logs.md)) |
| `TelemetryScheduleWatcher` | `wrap(className: string, methodName: string, fn: () => Promise<any>): Promise<any>` | **use** ([Schedules](../watchers/schedules.md)) |
| `TelemetryEventWatcher` | `record(eventName: string, payload: any, handlerClass: string, handlerMethod: string): Promise<void>` | **use** ([Events](../watchers/events.md)) |
| `recordException` | `(storage: TelemetryStorage, exception: any, req: any) => void` | **use** ([Exceptions](../watchers/exceptions.md)) |
| `TelemetryRequestInterceptor` | Global interceptor | **wired** |
| `TelemetryExceptionInterceptor` | Global interceptor | **wired** |
| `TelemetryCacheInterceptor` | Global interceptor | **wired** |
| `TelemetrySecurityGuard` | Guard of the dashboard's routes, built with the module options: `new TelemetrySecurityGuard({ accessToken })` | **wired** |
| `TelemetryExceptionFilter` | Re-throwing exception filter | **avoid**: see [Exceptions](../watchers/exceptions.md#telemetryexceptionfilter) |

Inject the watchers from the global module; do not list them in your own `providers` (see [Watchers overview](../watchers/overview.md#injecting-a-watcher)).

## @nestjs-telemetry/typeorm

| Export | Kind | |
| --- | --- | --- |
| `TelemetryTypeOrmModule` | Module: attaches both subscribers to the default `DataSource` | **use** |
| `TelemetryQuerySubscriber` | `new TelemetryQuerySubscriber(storage)`, implements `afterQuery` | **wired** |
| `TelemetryModelSubscriber` | `new TelemetryModelSubscriber(storage)`, implements `afterInsert`, `afterUpdate`, `afterRemove` | **wired** |

The subscribers can be pushed onto another `DataSource`'s `subscribers` by hand, for a named connection. See [TypeORM](../integrations/typeorm.md).

## @nestjs-telemetry/prisma

| Export | Kind | |
| --- | --- | --- |
| `createTelemetryQueryMiddleware(storage)` | Returns a `$use` middleware `(params, next) => Promise<any>` | **use** (Prisma 5 to 6.13) |
| `createTelemetryModelMiddleware(storage)` | Same, for writes | **use** (Prisma 5 to 6.13) |
| `TelemetryPrismaModule` | Empty module | reference |

See [Prisma](../integrations/prisma.md).
