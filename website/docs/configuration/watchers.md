---
title: Watcher toggles
description: What each watchers.* switch turns off, where it is read, and how to turn off the watchers whose switch has no effect.
---

`watchers` holds one boolean per entry type. All default to `true`. They do not all work the same way, because the watchers are not all wired the same way:

- **Bound interceptors** (requests, exceptions, cache) run on every HTTP request. Their switch replaces the interceptor with a pass-through.
- **Mail** is instrumented automatically at startup. Its switch skips the instrumentation and makes the mail watcher record nothing.
- **Passive helpers** (logs, schedules, events) record only what your code hands them. They are always registered, and their switch is not read.
- **ORM watchers** (queries, models) live in the TypeORM and Prisma packages, which do not read the core options.

## What each switch does

| Switch | Read by | Effect of `false` |
| --- | --- | --- |
| `requests` | core module | No `REQUEST` entries, and no batch context: see the warning below. |
| `exceptions` | core module | No `EXCEPTION` entries. |
| `cache` | core module | No `CACHE` entries. |
| `mail` | core module | No mail sender is instrumented; `TelemetryMailWatcher.record()` and `instrument()` do nothing. |
| `logs` | nothing | None. |
| `schedules` | nothing | None. |
| `events` | nothing | None. |
| `queries` | nothing | None. |
| `models` | nothing | None. |

:::warning[Current limitation]
`logs`, `schedules`, `events`, `queries` and `models` have no effect. To turn one of those off, do not wire it: do not install `TelemetryLogWatcher` as a logger, do not call `TelemetryScheduleWatcher.wrap()` or `TelemetryEventWatcher.record()`, do not import `TelemetryTypeOrmModule` or register the Prisma middlewares.
:::

:::warning[Current limitation]
The request interceptor is also what starts the batch context of a request (batch ID, user, tenant). With `requests: false`, entries recorded during a request (queries, logs, mail, exceptions) no longer carry a batch ID or the user and tenant. To stop recording requests but keep correlation, leave `requests` on and add the paths you do not want to `ignoredPrefixes`; note that an ignored path gets no batch context either.
:::

## A switch set to undefined

In `forRoot({ watchers: { requests: undefined } })`, or a factory that returns `undefined` for a switch, the value replaces the default. For `requests`, `exceptions` and `cache` that means **off**; `mail` treats `undefined` as on. Give every switch a boolean.

## Pausing at runtime

The switches are read once, at startup. To stop recording while the app runs, use the dashboard's **Enabled** button (or `POST {basePath}/api/toggle`): it pauses every watcher at once, since each one checks the storage's recording flag before storing. Entries already recorded stay. See [Using the dashboard](../dashboard/overview.md).
