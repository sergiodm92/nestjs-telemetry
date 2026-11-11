---
title: Watchers overview
description: The nine watchers, how each one is captured, what every entry has in common, and the rules all watchers follow.
---

A watcher turns something your application does into a telemetry entry. There are nine entry types, one per watcher.

| Type | Watcher | How it is captured | Switch | Page |
| --- | --- | --- | --- | --- |
| `REQUEST` | `TelemetryRequestInterceptor` | Automatic: global interceptor | `requests` | [Requests](./requests.md) |
| `EXCEPTION` | `TelemetryExceptionInterceptor` | Automatic: global interceptor | `exceptions` | [Exceptions](./exceptions.md) |
| `CACHE` | `TelemetryCacheInterceptor` | Automatic: global interceptor | `cache` | [Cache](./cache.md) |
| `MAIL` | `TelemetryMailWatcher` | Automatic for nodemailer and `MailerService`; `record()` for anything else | `mail` | [Mail](./mail.md) |
| `LOG` | `TelemetryLogWatcher` | You install it as the app logger | none | [Logs](./logs.md) |
| `SCHEDULE` | `TelemetryScheduleWatcher` | You wrap each job with `wrap()` | none | [Schedules](./schedules.md) |
| `EVENT` | `TelemetryEventWatcher` | You call `record()` from listeners | none | [Events](./events.md) |
| `QUERY` | TypeORM subscriber / Prisma middleware | ORM package | none | [TypeORM](../integrations/typeorm.md), [Prisma](../integrations/prisma.md) |
| `MODEL` | TypeORM subscriber / Prisma middleware | ORM package | none | [TypeORM](../integrations/typeorm.md), [Prisma](../integrations/prisma.md) |

"none" means the switch exists in `TelemetryWatcherOptions` but is not read: see [Watcher toggles](../configuration/watchers.md).

## What every entry has

Every entry is a `TelemetryEntry`:

| Field | Meaning |
| --- | --- |
| `uuid` | Unique id of the entry. |
| `type` | One of the nine types above. |
| `createdAt` | When it was recorded. |
| `batchId` | The batch it belongs to: the HTTP request (or scheduled run) it was recorded in, or `''`. |
| `content` | The type-specific data. See [Entry model](../concepts/entry-model.md) for every field. |
| `userIdentifier`, `tenantId` | The user and tenant of the request, or `''`. |
| `tags` | Short labels such as `query:select` or `mail:failed`. |

The batch ID is what links a request to the queries, logs, mail and exceptions it caused; see [Batch correlation](../concepts/batch-correlation.md).

## Injecting a watcher

`TelemetryModule` is global and exports `TelemetryLogWatcher`, `TelemetryScheduleWatcher`, `TelemetryEventWatcher`, `TelemetryMailWatcher` and the `TELEMETRY_STORAGE` token. Inject them by class:

```ts
import { Injectable } from '@nestjs/common';
import { TelemetryEventWatcher } from '@nestjs-telemetry/core';

@Injectable()
export class OrdersService {
  constructor(private readonly events: TelemetryEventWatcher) {}
}
```

Do not add these classes to your own module's `providers`: their constructors take the storage interface, which Nest cannot resolve by type, so listing them again fails dependency resolution. Use the instances the global module exports.

## Rules every watcher follows

- **Paused means nothing is stored.** Each watcher checks the storage's recording flag (the dashboard's **Enabled** button) before storing.
- **Recording is a side effect.** A watcher never changes your handler's arguments, result or error.
- **Telemetry should not break the app.** The request and mail watchers catch their own failures. Some other paths do not yet: the log watcher can throw on unusual arguments, and the Prisma middlewares can fail a query; those cases are listed on each page.
