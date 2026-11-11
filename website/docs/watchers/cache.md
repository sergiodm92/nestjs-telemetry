---
title: Cache
description: What the cache watcher actually records, why its HIT and MISS labels are a timing guess, and how to record real cache lookups yourself.
---

`TelemetryCacheInterceptor` is bound as a global interceptor and writes `CACHE` entries.

:::warning[Current limitation]
The cache watcher does not observe any cache. For **every** route handler that returns a value, it records an entry labelled `HIT` when the handler took less than 2 ms and `MISS` otherwise. It also records the dashboard's own API calls, about three every five seconds while the dashboard is open. The labels say nothing about `@nestjs/cache-manager` or any other cache.
:::

## What an entry holds

| Field | Content |
| --- | --- |
| `operation` | `HIT` (under 2 ms) or `MISS`. |
| `key` | `ControllerName.handlerName`. |
| `cacheName` | Always `''`. |
| `duration` | Milliseconds the handler took. |

Tags: `cache:hit` or `cache:miss`.

## Turn it off

Until the watcher observes a real cache, most applications are better off without it:

```ts
TelemetryModule.forRoot({ watchers: { cache: false } });
```

## Record real cache lookups yourself

The storage is injectable, so you can write accurate `CACHE` entries where your code talks to the cache. A small helper around `cache-manager`:

```ts title="src/common/telemetry-cache.ts"
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'node:crypto';
import {
  TELEMETRY_STORAGE,
  TelemetryContext,
  TelemetryEntryType,
  TelemetryStorage,
} from '@nestjs-telemetry/core';

@Injectable()
export class TelemetryCache {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Inject(TELEMETRY_STORAGE) private readonly storage: TelemetryStorage,
  ) {}

  async get<T>(key: string, cacheName = 'default'): Promise<T | undefined> {
    const start = Date.now();
    const value = await this.cache.get<T>(key);
    if (this.storage.isEnabled()) {
      const operation = value === undefined || value === null ? 'MISS' : 'HIT';
      void this.storage.store({
        uuid: randomUUID(),
        type: TelemetryEntryType.CACHE,
        createdAt: new Date(),
        batchId: TelemetryContext.getBatchId() ?? '',
        content: { operation, cacheName, key, duration: Date.now() - start },
        userIdentifier: TelemetryContext.getUserIdentifier() ?? '',
        tenantId: TelemetryContext.getTenantId() ?? '',
        tags: [`cache:${operation.toLowerCase()}`],
      });
    }
    return value ?? undefined;
  }
}
```

The dashboard's Cache view shows these entries like the built-in ones, with your cache name and key, and links them to the request that made the lookup.
