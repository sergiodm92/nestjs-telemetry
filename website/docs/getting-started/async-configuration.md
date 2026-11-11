---
title: Async configuration
description: Register TelemetryModule with forRootAsync to read its options from ConfigService, why basePath must also be passed directly, and how to write a factory that does not override defaults with undefined.
---

`TelemetryModule.forRootAsync()` builds the options with a factory, so you can read them from `ConfigService` or any other provider. It registers exactly the same providers, watchers and routes as `forRoot()`.

## Signature

```ts
TelemetryModule.forRootAsync({
  imports?: any[];          // modules the factory's dependencies come from
  inject?: any[];           // tokens handed to useFactory, in order
  useFactory: (...args) => TelemetryModuleOptions | Promise<TelemetryModuleOptions>;
  basePath?: string;        // where the dashboard and its API are mounted
});
```

## Example with ConfigService

```ts title="src/app.module.ts"
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelemetryModule, TelemetryModuleOptions } from '@nestjs-telemetry/core';

const TELEMETRY_PATH = '/telemetry';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TelemetryModule.forRootAsync({
      basePath: TELEMETRY_PATH,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): TelemetryModuleOptions => ({
        basePath: TELEMETRY_PATH,
        storage: config.get('TELEMETRY_STORAGE') === 'sqlite' ? 'sqlite' : 'memory',
        sqlitePath: config.get('TELEMETRY_SQLITE_PATH', '.telemetry.db'),
        accessToken: config.get('TELEMETRY_TOKEN', ''),
        pruneHours: Number(config.get('TELEMETRY_PRUNE_HOURS', 24)),
      }),
    }),
  ],
})
export class AppModule {}
```

Every `config.get()` above has a default, so no option ends up `undefined`. The next two sections explain why both details matter.

## Pass basePath twice

The dashboard routes are registered with `RouterModule` when the module is defined, which happens before your factory runs. That registration can only use the `basePath` you pass to `forRootAsync()` itself (default `/telemetry`). The `basePath` your factory returns is used afterwards, at request time, by the request watcher to skip the dashboard's own calls.

Keep both values the same, as in the example, by reading them from one constant:

| `basePath` passed to `forRootAsync` | `basePath` returned by the factory | Dashboard served at | Its own calls recorded as requests |
| --- | --- | --- | --- |
| not set | not set | `/telemetry` | no |
| `/admin/telemetry` | `/admin/telemetry` | `/admin/telemetry` | no |
| not set | `/admin/telemetry` | `/telemetry` | **yes** |

:::warning
Returning a `basePath` only from the factory does not move the dashboard: it stays at `/telemetry`. The access token is still asked there, since the guard is bound to the dashboard's routes, wherever they are mounted.
:::

## How options are merged

The factory's result is merged over the defaults with an object spread, and `watchers` is merged the same way one level down:

```ts
{ ...DEFAULT_OPTIONS, ...options, watchers: { ...DEFAULT_OPTIONS.watchers, ...options.watchers } }
```

A key that is absent keeps its default. A key that is present with the value `undefined` **replaces** the default with `undefined`. That is exactly what `config.get('SOME_VARIABLE')` returns for an unset variable.

:::warning[Current limitation]
An option set to `undefined` is not ignored. Depending on the option:

- `ignoredPrefixes: undefined` makes the request watcher throw on every request: every route of your app answers `500`.
- `basePath: undefined` (in `forRoot()`) or a missing `basePath` next to a factory value leaves the dashboard where you do not expect it.
- `pruneHours: undefined` or `NaN` makes each prune run delete every in-memory entry; `pruneIntervalMs` or `flushIntervalMs` set to `undefined` makes the timers fire every millisecond; `maxEntries: NaN` removes the per-type cap.
- `accessToken: undefined` silently leaves the dashboard open.

`watchers.mail: undefined` is the only value read as "keep the default".
:::

Two ways to stay safe:

1. Give every `config.get()` a default, as in the example above, or use `getOrThrow()` for values that must be set (an access token outside your machine).
2. Drop undefined values before returning:

```ts title="src/telemetry.options.ts"
import { TelemetryModuleOptions } from '@nestjs-telemetry/core';

export function definedOnly(options: TelemetryModuleOptions): TelemetryModuleOptions {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as TelemetryModuleOptions;
}
```

```ts
useFactory: (config: ConfigService) =>
  definedOnly({
    accessToken: config.get('TELEMETRY_TOKEN'),
    storage: config.get('TELEMETRY_STORAGE'),
  }),
```

Numeric values read from the environment are strings: convert them with `Number()` and keep a default, as the example does for `pruneHours`.

## The factory runs once

The factory runs once, while the application starts. Changing an environment variable afterwards has no effect until the next start. The resolved options are held under the `TELEMETRY_OPTIONS` token inside the module; that token is not exported to the rest of your app.
