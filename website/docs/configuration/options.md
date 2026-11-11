---
title: Options reference
description: Every TelemetryModuleOptions and TelemetryWatcherOptions property, its type, its default and what reads it, with three ready-made setups.
---

`TelemetryModule.forRoot(options)` and the factory of `forRootAsync()` take a `TelemetryModuleOptions` object. Every property is optional; the defaults come from `DEFAULT_OPTIONS` in `packages/core/src/telemetry.options.ts`.

## TelemetryModuleOptions

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `storage` | `'memory' \| 'sqlite'` | `'memory'` | Where entries are kept. Any value other than `'sqlite'` selects memory. See [Storage](./storage.md). |
| `sqlitePath` | `string` | `'.telemetry.db'` | Path of the SQLite database file, relative to the process's working directory. Used only with `storage: 'sqlite'`. |
| `basePath` | `string` | `'/telemetry'` | Path the dashboard page is served at; the JSON API is under `{basePath}/api`. Write it with a leading slash and no trailing slash. |
| `externalBasePath` | `string` | `basePath` | The dashboard path as requests really carry it, when a global prefix is applied on top of `basePath`. Read by the request watcher, to leave the dashboard's own calls out of the recorded requests. It plays no part in the access token. See [Global prefix](./global-prefix.md). |
| `maxEntries` | `number` | `1000` | Most entries kept per type by the in-memory storage; the oldest is dropped when a new one arrives. Ignored by SQLite. |
| `pruneHours` | `number` | `24` | Entries older than this many hours are deleted by the periodic prune. |
| `pruneIntervalMs` | `number` | `3600000` | How often the periodic prune runs (1 hour). |
| `accessToken` | `string` | `''` | When non-empty, the dashboard and its API require this token. See [Access token and security](./security.md). |
| `ignoredPrefixes` | `string[]` | `['/health', '/swagger', '/api-docs']` | Requests whose path starts with one of these strings are not recorded. A plain string prefix: `/health` also skips `/healthcare`. |
| `basePackage` | `string` | `''` | When set, the log watcher records only log lines whose context starts with this string. See [Logs](../watchers/logs.md). |
| `flushIntervalMs` | `number` | `2000` | How often buffered entries are written to SQLite. |
| `watchers` | `TelemetryWatcherOptions` | all `true` | Per-watcher switches, below. |

## TelemetryWatcherOptions

| Option | Default | Effect today |
| --- | --- | --- |
| `requests` | `true` | `false` replaces the request interceptor with a pass-through. |
| `exceptions` | `true` | `false` replaces the exception interceptor with a pass-through. |
| `cache` | `true` | `false` replaces the cache interceptor with a pass-through. |
| `mail` | `true` | `false` turns off mail discovery and makes `TelemetryMailWatcher` record nothing. |
| `queries` | `true` | Not read by any package. |
| `models` | `true` | Not read by any package. |
| `logs` | `true` | Not read: the log watcher records whatever it is given. |
| `schedules` | `true` | Not read. |
| `events` | `true` | Not read. |

[Watcher toggles](./watchers.md) explains each switch and how to turn off the ones that are not read.

## Merge rules

- The options you pass are spread over `DEFAULT_OPTIONS`, and `watchers` is spread over the default watchers. A key you leave out keeps its default.
- A key present with the value `undefined` replaces the default with `undefined`; see [Async configuration](../getting-started/async-configuration.md#how-options-are-merged) for what that breaks.
- Numbers are not validated: `0`, negative values and `NaN` are used as given.
- Options are read once, at startup.

## Ready-made setups

### Local development, in memory

```ts title="src/app.module.ts"
TelemetryModule.forRoot({
  maxEntries: 500,
  ignoredPrefixes: ['/health', '/metrics'],
  watchers: { cache: false },
});
```

### Persistent, with SQLite

```ts title="src/app.module.ts"
TelemetryModule.forRoot({
  storage: 'sqlite',
  sqlitePath: 'var/telemetry.db',
  pruneHours: 72,
  pruneIntervalMs: 15 * 60 * 1000,
  flushIntervalMs: 1000,
});
```

Add `var/telemetry.db*` to `.gitignore`: WAL mode creates `-wal` and `-shm` files next to the database.

### Shared environment behind a global prefix

```ts title="src/main.ts"
app.setGlobalPrefix('api/v1');
```

```ts title="src/app.module.ts"
TelemetryModule.forRoot({
  accessToken: process.env.TELEMETRY_TOKEN ?? '',
  externalBasePath: '/api/v1/telemetry',
  ignoredPrefixes: ['/api/v1/health'],
});
```

The dashboard is then at `/api/v1/telemetry?token=...`. Note that `ignoredPrefixes` is compared with the full path, prefix included.
