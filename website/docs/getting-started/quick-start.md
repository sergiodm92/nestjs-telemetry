---
title: Quick start
description: Register TelemetryModule, open the dashboard and see your first request, then learn which watchers work on their own and which need a line of wiring.
---

This page takes you from an existing NestJS application to a dashboard that shows its requests. It assumes the package is installed ([Installation](./installation.md)) and that the app uses the default Express adapter.

## 1. Register the module

Import `TelemetryModule.forRoot()` once, in your root module:

```ts title="src/app.module.ts"
import { Module } from '@nestjs/common';
import { TelemetryModule } from '@nestjs-telemetry/core';

@Module({
  imports: [TelemetryModule.forRoot()],
})
export class AppModule {}
```

The module is global: every other module can inject what it exports (the storage and the watchers) without importing it again. With no options, entries are kept in memory, the dashboard is served at `/telemetry`, and it has no access token. Every option is described in the [Options reference](../configuration/options.md).

## 2. Start the app and open the dashboard

```bash
npm run start:dev
```

Open `http://localhost:3000/telemetry` (use your app's port). The page shows a sidebar with one view per entry type and a home view with counters and the last requests.

## 3. Make a request

Call any route of your app, from a browser, `curl` or your frontend:

```bash
curl http://localhost:3000/
```

Within five seconds (the dashboard refreshes on its own) the request appears in **Requests**: method, path, status and duration. Click it to see the headers, the request body, the response body and every entry recorded while that request was handled. [Using the dashboard](../dashboard/overview.md) walks through every view.

## What works with no extra code

| Watcher | With `forRoot()` alone |
| --- | --- |
| Requests | Yes. A global interceptor records every HTTP request that reaches an interceptor. |
| Exceptions | Yes. A global interceptor records every error thrown by a handler or a pipe, and re-throws it. |
| Mail | Yes, for nodemailer transporters and the `MailerService` of `@nestjs-modules/mailer` that are providers, or fields of a provider, when the app starts. See [Mail](../watchers/mail.md). |
| Cache | Yes, but see the warning on [Cache](../watchers/cache.md): it does not observe a real cache. |
| Logs | No. Install `TelemetryLogWatcher` as a logger: see [Logs](../watchers/logs.md). |
| Schedules | No. Run each job through `TelemetryScheduleWatcher.wrap()`: see [Schedules](../watchers/schedules.md). |
| Events | No. Call `TelemetryEventWatcher.record()` from your listeners: see [Events](../watchers/events.md). |
| Queries and models | No. Add the [TypeORM](../integrations/typeorm.md) or [Prisma](../integrations/prisma.md) package. |

## Before you go further

:::warning[Current limitation]
The request, exception and cache interceptors are bound to every route of the application and assume an HTTP request. In an application that also serves GraphQL, every top-level resolver fails with a `TypeError` once the module is imported, and microservice (RPC) handlers produce empty `REQUEST` entries. Use the package in HTTP-only applications for now.
:::

- **Global prefix.** If `main.ts` calls `app.setGlobalPrefix('api')`, the dashboard moves to `/api/telemetry`, and `externalBasePath` keeps its own calls out of the Requests view. Read [Global prefix and externalBasePath](../configuration/global-prefix.md).
- **A global interceptor that wraps responses.** If your app wraps every response (for example `{ data: ... }`), the dashboard shows nothing until you exempt its routes: see [Serving and embedding the dashboard](../dashboard/embedding.md).
- **Anything beyond your machine.** Set an access token first: [Access token and security](../configuration/security.md).

## Next steps

- Read your options from configuration with [Async configuration](./async-configuration.md).
- Persist entries across restarts with the [SQLite storage](../configuration/storage.md).
- Wire the [watchers](../watchers/overview.md) that need a line of code.
