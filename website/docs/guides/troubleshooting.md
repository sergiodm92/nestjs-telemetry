---
title: Troubleshooting
description: Symptoms, causes and fixes for the problems people run into with NestJS Telemetry - the dashboard, the access token, empty views, ORM packages, SQLite and tests.
---

## The dashboard answers 404

- **A global prefix moved it.** With `app.setGlobalPrefix('api')` the dashboard is at `/api/telemetry`. See [Global prefix](../configuration/global-prefix.md).
- **`forRootAsync` with a custom path.** The route uses the `basePath` passed to `forRootAsync()` itself, not the one your factory returns. See [Async configuration](../getting-started/async-configuration.md#pass-basepath-twice).
- **The module is not imported** in the root module, or it is registered only under a condition that is false (a development-only setup with `NODE_ENV=production`).

## The dashboard loads but stays empty

- **A global interceptor wraps every response** (`{ data: ... }`): the page finds its data one level too deep. Exempt the telemetry controller: see [Serving and embedding](../dashboard/embedding.md#apps-that-wrap-every-response).
- **The API calls fail.** Open the browser's network tab: a `403` means the page was opened without `?token=`; a `401` comes from one of your own guards (next section); `404` on `/api/...` means a proxy does not forward the API path.
- **The page is unstyled or inert**: the CDN scripts were blocked (offline, or a Content-Security-Policy). See [What it loads](../dashboard/embedding.md#what-it-loads).
- **Recording is paused**: the counters stay at zero while requests come in. Click **Enabled** twice (the first click reports the real state), or `POST /api/toggle`.

## A 401 on the dashboard, with the right token

Your own global guard (an app-wide JWT guard) runs on the dashboard routes too, and the browser does not send a bearer token there. Let the dashboard path through your guard when `accessToken` is set: see [Your own global guards](../configuration/security.md#your-own-global-guards).

## The access token is not enforced

- **`accessToken` is empty or `undefined`**: an unset environment variable leaves the dashboard open, and nothing says so. Read it with `getOrThrow()` (see [Set an access token](../configuration/security.md#set-an-access-token)).
- **Version 0.2.3 or earlier**: the guard compared paths, so a global prefix without `externalBasePath`, a `basePath` without its leading slash, a `basePath` returned only by the `forRootAsync` factory, a case variant of the URL (`/TELEMETRY/api/...`) and Fastify all skipped the token. Upgrade: the guard is now bound to the dashboard's routes (see [Where the token is checked](../configuration/security.md#where-the-token-is-checked)).

## The dashboard's own calls fill the Requests view

Under a global prefix, set `externalBasePath` to the prefixed path, and write `basePath` with a leading slash and no trailing one (see [Global prefix and externalBasePath](../configuration/global-prefix.md)).

## Every route of my app answers 500 after adding the module

- **An option set to `undefined`**, typically `ignoredPrefixes: config.get('...')` for an unset variable: see [How options are merged](../getting-started/async-configuration.md#how-options-are-merged).
- **GraphQL resolvers** fail with a `TypeError` in the request interceptor: the module supports HTTP-only apps for now.
- **A body full of `eyJ`-like text** used to block the event loop for seconds in the JWT masking; fixed in the current version, upgrade.

## The Mail view is empty

See the checklist on [Mail](../watchers/mail.md#the-mail-view-is-empty). The most common causes: a transporter created after startup, an HTTP API client instead of nodemailer, or application code that skips sending outside production.

## Logs, schedules or events do not show up

They are not captured on their own:

- **Logs**: install a logger that forwards to `TelemetryLogWatcher`. See [Logs](../watchers/logs.md).
- **Schedules**: wrap each job with `TelemetryScheduleWatcher.wrap()`. See [Schedules](../watchers/schedules.md).
- **Events**: call `TelemetryEventWatcher.record()`, or record every emission with `onAny()`. See [Events](../watchers/events.md).

## My console went silent

You installed `TelemetryLogWatcher` directly with `app.useLogger()`. It records but does not print. Use the forwarding logger from [Logs](../watchers/logs.md#install-it-and-keep-the-console).

## Queries do not show up

- **TypeORM older than 0.3.18** has no `afterQuery` event. Upgrade TypeORM.
- **`TelemetryTypeOrmModule` is not imported**, or your queries run on a named `DataSource`: only the default one is instrumented.
- **Prisma**: the middlewares must be registered with `$use()` in your `PrismaService`.

## Prisma: `this.$use is not a function`

Prisma removed `$use` in 6.14. Use the client extension from [Prisma](../integrations/prisma.md#prisma-614-and-later-a-client-extension), or stay below 6.14.

## Prisma: "Do not know how to serialize a BigInt"

The Prisma middlewares copy arguments with `JSON.stringify`, which throws on `BigInt`, failing your query. Use the client extension from [Prisma](../integrations/prisma.md), which converts them.

## better-sqlite3 fails to install or load

See [The native SQLite dependency](../getting-started/installation.md#the-native-sqlite-dependency): pnpm's build approval, a Node.js version change (`npm rebuild better-sqlite3`), or a Docker image mismatch.

## SQLite: the dashboard returns 500 and nothing new is stored

One entry could not be serialized (usually a `BigInt` id) and blocks every flush. `GET /api/memory` shows `bufferSize` growing while `dbEntries` stays still. Find what produces it (ORM entities with `bigint` keys), stop it, then restart the app; the blocked buffer is lost with the process.

## The SQLite file keeps growing

Nothing caps it besides pruning. Lower `pruneHours`, check that the prune timer runs (`pruneIntervalMs`), or call `POST /api/prune?hours=N`.

## Memory use is high

The in-memory storage keeps up to `maxEntries` entries per type, nine types, each request with up to two 10 KB bodies. Lower `maxEntries`, turn off the cache watcher, and add noisy paths to `ignoredPrefixes`.

## Entries have no user

- The user is read from `req.user` when the request reaches the interceptor: authentication that sets it later (inside the handler) is not seen.
- A user object without `email`, `username`, `id` or `sub` is recorded as `[object Object]`.
- With `watchers.requests: false` there is no request context at all.

## The user filter finds nothing

Numeric ids are stored as numbers and the filter compares them with a string. Make `req.user.id` a string, or identify users by `email` or `username`.

## Jest does not exit

An application created in a test was not closed: the prune and flush timers keep the process alive. Call `await app.close()` in `afterAll`.
