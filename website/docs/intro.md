---
title: Introduction
description: NestJS Telemetry adds a real-time debugging dashboard to NestJS 10 and 11 applications that records requests, exceptions, queries, logs, scheduled jobs, cache, events, mail and model changes.
---

NestJS Telemetry is a debugging dashboard you add to a NestJS application with one module import. While the application runs, watchers record what it does: HTTP requests and their responses, exceptions, SQL queries, log lines, scheduled jobs, cache lookups, events, mail and entity changes. The application itself serves a dashboard, at `/telemetry` by default, where you browse those entries as they arrive. If you know Laravel Telescope, this is the same idea for NestJS: no agent to run, no collector, no external service.

## Who it is for

NestJS Telemetry is for developers who want to see what their application did, request by request, while they build and test it: the status and body a client received, the exception behind a 500, the queries and log lines a request produced, the mail it sent. It also works as a shared debugging view on a development or staging server.

It is not an APM product or an OpenTelemetry SDK. It exports nothing: entries stay in the application's memory or in a local SQLite file, and the dashboard reads them from there.

## What it records

Every entry has one of nine types. Each type is captured in one of three ways:

- **Automatic**: active as soon as you import `TelemetryModule`.
- **Watcher call**: you hand data to an injectable watcher from your own code.
- **ORM package**: you install and register `@nestjs-telemetry/typeorm` or `@nestjs-telemetry/prisma`.

| Type | What is recorded | How it is captured |
| --- | --- | --- |
| `REQUEST` | Method, path, query string, status, duration, client IP, request and response headers and bodies (masked, then cut at 10,000 characters) | Automatic. A global interceptor writes one entry per HTTP request when its response ends. See [Requests](./watchers/requests.md). |
| `EXCEPTION` | Error class, message, stack trace (up to 5,000 characters), file and line, the request's method and path, cause | Automatic. A global interceptor records any error thrown while a route handler runs (pipes included) and re-throws it unchanged. See [Exceptions](./watchers/exceptions.md). |
| `QUERY` | TypeORM: SQL, statement type, duration, parameters. Prisma: model, action, statement type, duration, arguments, error | ORM package. See [TypeORM](./integrations/typeorm.md) and [Prisma](./integrations/prisma.md). |
| `LOG` | Level, message, context, trace | Watcher call. `TelemetryLogWatcher` is a `LoggerService` that you register with `app.useLogger()`. See [Logs](./watchers/logs.md). |
| `SCHEDULE` | Class and method name, status (`completed` or `failed`), duration, error message | Watcher call. You run each job body through `TelemetryScheduleWatcher.wrap()`. See [Schedules](./watchers/schedules.md). |
| `CACHE` | Key (`ControllerName.handlerName`), `HIT` or `MISS`, duration | Automatic. A global interceptor records every route handler that returns a value. See [Cache](./watchers/cache.md). |
| `EVENT` | Event name, payload, payload class, handler class and method | Watcher call. You call `TelemetryEventWatcher.record()` from your listeners. See [Events](./watchers/events.md). |
| `MAIL` | Recipients, sender, subject, HTML and text bodies, a text preview, attachment names and sizes, sent or failed, error, duration, message id | Automatic for nodemailer transporters and the `MailerService` of `@nestjs-modules/mailer` found among your providers at startup. Watcher call (`TelemetryMailWatcher`) for any other sender. See [Mail](./watchers/mail.md). |
| `MODEL` | Entity, action (`CREATED`, `UPDATED` or `DELETED`), entity id, changed fields (TypeORM) or written data (Prisma) | ORM package. See [TypeORM](./integrations/typeorm.md) and [Prisma](./integrations/prisma.md). |

Entries recorded while an HTTP request is handled share that request's batch ID, so the dashboard can list everything one request caused next to it. See [Batch correlation](./concepts/batch-correlation.md).

:::warning[Current limitation]
- Logs, scheduled jobs and events are not captured on their own. The module does not hook into Nest's logger, `@nestjs/schedule` or `@nestjs/event-emitter`, so those views stay empty until you wire the corresponding watcher.
- The cache watcher does not look at any cache. It records a `CACHE` entry for every route handler that returns a value, the dashboard's own API routes included, and labels it `HIT` when the handler took less than 2 ms and `MISS` otherwise.
:::

## Packages

| Package | Version | What it adds |
| --- | --- | --- |
| [`@nestjs-telemetry/core`](https://www.npmjs.com/package/@nestjs-telemetry/core) | 0.2.3 | `TelemetryModule`, the request, exception, log, schedule, cache, event and mail watchers, in-memory and SQLite storage, the REST API and the dashboard. |
| [`@nestjs-telemetry/typeorm`](https://www.npmjs.com/package/@nestjs-telemetry/typeorm) | 0.2.0 | `TelemetryTypeOrmModule`, which attaches a query subscriber and an entity subscriber to your TypeORM `DataSource`. |
| [`@nestjs-telemetry/prisma`](https://www.npmjs.com/package/@nestjs-telemetry/prisma) | 0.1.0 | `createTelemetryQueryMiddleware()` and `createTelemetryModelMiddleware()`, which you register on your `PrismaClient` with `$use()`. |

The versions are the ones in each package's package.json. Both ORM packages require the core package as a peer dependency, in the range `^0.1.0` or `^0.2.0`.

## How it works

`TelemetryModule.forRoot()` returns a global dynamic module. It creates the storage, binds three global interceptors (requests, exceptions, cache), registers the log, schedule, event and mail watchers as injectable providers, instruments the `sendMail()` of the mail senders it finds among your providers at startup, and mounts a controller at `basePath` that serves the dashboard page and a JSON API under `{basePath}/api`, behind a guard that checks the access token when you set one. While a request is handled, the request interceptor keeps a batch ID in `AsyncLocalStorage`, and every entry recorded in that async context carries it. A background service deletes entries older than `pruneHours` and flushes the SQLite write buffer. The dashboard is a single HTML page that calls the API every five seconds. [Architecture](./concepts/architecture.md) describes each piece.

## Requirements

| Requirement | Details |
| --- | --- |
| Node.js | 18 or later. This is the `engines` field of the repository's root package.json. The published packages declare no `engines` field, so your package manager does not check it. |
| NestJS | 10 or 11. `@nestjs/common` and `@nestjs/core` are peer dependencies in the range `^10.0.0` or `^11.0.0`, together with `reflect-metadata` (`^0.1.13` or `^0.2.0`) and `rxjs` (`^7.0.0`). The test suite runs on NestJS 10. |
| HTTP adapter | Express (`@nestjs/platform-express`, the Nest default). The dashboard route is written against Express's response object (`res.type().send()`), and the tests run on Express only. The access-token guard does not depend on the adapter: it reads only the `token` query parameter and the `x-telemetry-token` header. |
| Native build tools | Only when no prebuilt `better-sqlite3` binary matches your platform. See [The native SQLite dependency](./getting-started/installation.md#the-native-sqlite-dependency). |
| Browser | The dashboard page loads Tailwind CSS from `cdn.tailwindcss.com` and Alpine.js from `cdn.jsdelivr.net`, so the browser that opens it must be able to reach both. A Content-Security-Policy that your application sends on every response (from helmet, for example) applies to the dashboard page too. |

:::note
Fastify is not covered by the test suite. Up to 0.2.3, the access-token guard read Express's `req.path`, which a Fastify request does not have, so on `@nestjs/platform-fastify` the token protected nothing. The guard no longer looks at the path.
:::

## Where it fits

NestJS Telemetry is built for development and staging. Before you run it anywhere else, know what it does by default:

- **The dashboard and its API are open.** With no `accessToken`, anyone who can reach the application can read every entry and call the API routes that clear entries or pause recording. See [Access token and security](./configuration/security.md).
- **It keeps request and response headers and bodies.** Credentials are masked by field name and by the shape of a JWT, which does not catch everything. See [Data masking](./concepts/data-masking.md).
- **Entries live in memory.** The default storage keeps up to 1,000 entries per type, loses them when the process restarts, and holds them separately in each instance of a scaled-out application. [Storage](./configuration/storage.md) covers the SQLite alternative.
- **Each request costs extra work.** Text responses up to 256 KB are copied and masked before they are stored.

To keep the package out of production installs, add it as a development dependency: see [Development-only setup](./getting-started/installation.md#development-only-setup). If you run it beyond development, go through the [Production checklist](./guides/production.md) first.

## Next steps

- [Installation](./getting-started/installation.md): package managers, peer dependencies, the native SQLite module and a development-only setup.
- [Quick start](./getting-started/quick-start.md): from `forRoot()` to your first request in the dashboard.
- [Options reference](./configuration/options.md): every option and its default.
- [Watchers overview](./watchers/overview.md): what each watcher records and how to wire the ones that are not automatic.
- [Using the dashboard](./dashboard/overview.md): views, filters and the entry detail.
