---
title: Custom storage
description: The contract a TelemetryStorage implementation must follow, method by method, and what can and cannot be plugged in today.
---

Everything the watchers write and the dashboard reads goes through the `TelemetryStorage` interface (see [Public API](./public-api.md#storage)). This page states the contract the two built-in storages share, so you can write, test or review another one.

## Plugging one in

:::warning[Current limitation]
There is no supported way to plug your own storage into an application: the `storage` option accepts `'memory'` or `'sqlite'`, and the `TELEMETRY_STORAGE` provider is defined inside the module, where an importing module cannot replace it.
:::

In tests you can replace it, since Nest's testing module can override any provider:

```ts
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(TELEMETRY_STORAGE)
  .useValue(new MyStorage())
  .compile();
```

## The contract

| Method | Must |
| --- | --- |
| `store(entry)` | Keep the entry. Do nothing while `isEnabled()` is false. Never throw for a valid entry; the watchers call it from inside your requests. |
| `getByType(type, filters, page, size)` | Return the entries of `type` matching `filters`, **newest first**, skipping `page * size` and returning at most `size`. Filter first, paginate second. Include entries not yet flushed. |
| `countByType(type, filters)` | Count with exactly the same predicate as `getByType`, so the dashboard's pager agrees with the pages. |
| `getByUuid(uuid)` | Return the entry or `null`, buffered entries included. |
| `getByBatchId(batchId)` | Return every entry with that batch, of every type, **oldest first**. |
| `getStats()` | Return a count per type, with a key for every `TelemetryEntryType`, buffered entries included. |
| `clear()` / `clearByType(type)` | Delete everything / every entry of one type, buffer included. |
| `pruneOlderThan(date)` | Delete entries with `createdAt` before `date`, buffer included; return how many. |
| `getDistinctTags()`, `getDistinctUserIdentifiers()`, `getDistinctTenantIds()` | Return sorted unique values, without `''`. |
| `getMemoryInfo()` | Return any JSON object describing the storage; `/api/memory` and `/api/status` show it as is. |
| `isEnabled()` / `setEnabled(enabled)` | The recording flag behind the dashboard's **Enabled** button; start enabled. |
| `flush()` | Persist whatever is buffered; a no-op when nothing is. Called every `flushIntervalMs` and at shutdown. |

### Filter semantics

| Filter | Matches when |
| --- | --- |
| `userIdentifier`, `tenantId` | The entry's field is equal. |
| `method` | `content.method` equals it, ignoring case. Entries without one never match. |
| `statusGroup` | `` `${Math.floor(content.status / 100)}xx` `` equals it (`2xx`...`5xx`). Entries without a status never match. |
| `search` | Some top-level value of `content`, converted with `String()`, contains it, ignoring case. |

All present filters must match.

## A starting point

Extending a built-in storage is the easiest way to add behavior, for example forwarding entries somewhere else as they arrive:

```ts title="src/telemetry/forwarding.storage.ts"
import { InMemoryTelemetryStorage, TelemetryEntry } from '@nestjs-telemetry/core';

export class ForwardingStorage extends InMemoryTelemetryStorage {
  constructor(private readonly forward: (entry: TelemetryEntry) => void, maxEntries = 1000) {
    super(maxEntries);
  }

  async store(entry: TelemetryEntry): Promise<void> {
    await super.store(entry);
    if (!this.isEnabled()) return;
    try {
      this.forward(entry);
    } catch {
      // A failing destination must not fail the request that produced the entry.
    }
  }
}
```

## Testing an implementation

The repository checks both storages against the same scenarios in `packages/core/test/storage.consistency.spec.ts`: 60 requests and a few logs, every filter combination, pages that must add up to the count, newest-first order. Run your implementation through the same scenarios: the fixtures are in `packages/core/test/support/entries.ts`.
