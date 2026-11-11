---
title: Batch correlation
description: How entries recorded during one request share a batch ID through AsyncLocalStorage, where batches start, and how to run your own code inside one.
---

Every entry has a `batchId`. Entries recorded while handling the same HTTP request (or the same scheduled run) share it, which is how the dashboard shows "everything this request did" next to the request.

## TelemetryContext

`TelemetryContext` wraps one `AsyncLocalStorage<TelemetryStore>`:

```ts
interface TelemetryStore {
  batchId: string;
  userIdentifier?: string;
  tenantId?: string;
}
```

| Method | Does |
| --- | --- |
| `TelemetryContext.run(store, fn)` | Runs `fn` with `store` as the current context; everything `fn` starts asynchronously inherits it. |
| `getStore()` | The current store, or `undefined`. |
| `getBatchId()`, `getUserIdentifier()`, `getTenantId()` | Fields of the current store. |
| `getOrCreateBatchId()` | The current batch ID, or a new UUID. It does not enter a context. |

Watchers read the current store when they record. Outside any context the fields are `''`.

## Where batches start

- **The request interceptor** creates one batch per HTTP request, with the user and tenant from `req.user`, and runs the rest of the chain (interceptors, pipes, handler) inside it.
- **`TelemetryScheduleWatcher.wrap()`** creates one batch per run.
- **Mail** keeps the batch of the code that called `sendMail()`, even when the transport answers later.

## Your own batches

Work that does not start with an HTTP request (a queue consumer, a message handler, a CLI command) has no batch. Give it one so its entries group together:

```ts title="src/emails/email.consumer.ts"
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TelemetryContext } from '@nestjs-telemetry/core';

@Injectable()
export class EmailConsumer {
  async handle(job: { id: string; userEmail: string; data: unknown }) {
    return TelemetryContext.run({ batchId: randomUUID(), userIdentifier: job.userEmail }, () =>
      this.process(job.data),
    );
  }

  private async process(data: unknown) {
    // queries, logs and mail recorded here share the batch above
  }
}
```

The dashboard's related-entries list works for these batches too; there is just no `REQUEST` entry among them.

## Related entries

`GET {basePath}/api/entries/:uuid/related` returns every entry with the same batch ID as the given one, oldest first (an entry without a batch has no related entries). The detail panel lists them under **Related entries (same request)**.

## When the context is lost

`AsyncLocalStorage` follows promises, timers and callbacks created inside the context. It does not follow work that was queued before the context existed and resumes later, such as a connection pool that calls back from the context of the request that opened the connection, or an event emitter whose listeners were attached elsewhere and that is driven by another source. Entries recorded there carry another batch, or none. The mail watcher handles the pool case itself; for the rest, run the work inside `TelemetryContext.run()` at the point where it starts.

Also:

- Middleware, guards and exception filters run outside the request's context: their log lines are not linked to it.
- With `watchers.requests: false` no request context is created at all, so nothing recorded during requests carries a batch, user or tenant.
