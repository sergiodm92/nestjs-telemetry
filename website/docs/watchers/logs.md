---
title: Logs
description: Record your application's log lines with TelemetryLogWatcher, keep printing them to the console, and filter them by context.
---

`TelemetryLogWatcher` is a Nest `LoggerService` that stores every line it receives as a `LOG` entry. It is not installed for you: the module registers it as an injectable, and you decide how log lines reach it.

## What an entry holds

| Field | Content |
| --- | --- |
| `level` | `LOG`, `ERROR`, `WARN`, `DEBUG` or `VERBOSE`. |
| `message` | The message, or `JSON.stringify(message)` when it is not a string. |
| `context` | The second argument of the call (the context, for `Logger` instances). |
| `trace` | For `error()`, its second argument (the stack). |

Tags: `log:<level>`, for example `log:error`. A line logged while a request is handled carries that request's batch ID, so it appears with the request in the dashboard.

## Install it and keep the console

The watcher only records: it never prints. Installing it directly with `app.useLogger(app.get(TelemetryLogWatcher))` replaces Nest's logger, so your console goes silent. Install a logger that does both instead:

```ts title="src/telemetry-console.logger.ts"
import { ConsoleLogger } from '@nestjs/common';
import { TelemetryLogWatcher } from '@nestjs-telemetry/core';

/** Prints like Nest's ConsoleLogger and records every line in the telemetry dashboard. */
export class TelemetryConsoleLogger extends ConsoleLogger {
  constructor(private readonly telemetry: TelemetryLogWatcher) {
    super();
  }

  log(message: any, ...params: any[]) {
    super.log(message, ...params);
    this.telemetry.log(asText(message), contextOf(params));
  }

  warn(message: any, ...params: any[]) {
    super.warn(message, ...params);
    this.telemetry.warn(asText(message), contextOf(params));
  }

  debug(message: any, ...params: any[]) {
    super.debug(message, ...params);
    this.telemetry.debug(asText(message), contextOf(params));
  }

  verbose(message: any, ...params: any[]) {
    super.verbose(message, ...params);
    this.telemetry.verbose(asText(message), contextOf(params));
  }

  error(message: any, ...params: any[]) {
    super.error(message, ...params);
    this.telemetry.error(asText(message), stackOf(message, params), contextOf(params));
  }

  fatal(message: any, ...params: any[]) {
    super.fatal(message, ...params);
    this.telemetry.error(asText(message), stackOf(message, params), contextOf(params));
  }
}

function asText(message: unknown): string {
  if (message instanceof Error) return message.message;
  if (typeof message === 'string') return message;
  try {
    return JSON.stringify(message, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
  } catch {
    return String(message);
  }
}

/** Nest passes the context last. */
function contextOf(params: unknown[]): string | undefined {
  const last = params[params.length - 1];
  return typeof last === 'string' ? last : undefined;
}

function stackOf(message: unknown, params: unknown[]): string | undefined {
  if (message instanceof Error) return message.stack;
  return params.length > 1 && typeof params[0] === 'string' ? params[0] : undefined;
}
```

```ts title="src/main.ts"
import { NestFactory } from '@nestjs/core';
import { TelemetryLogWatcher } from '@nestjs-telemetry/core';
import { AppModule } from './app.module';
import { TelemetryConsoleLogger } from './telemetry-console.logger';

async function bootstrap() {
  // bufferLogs holds the startup lines until the logger below is installed, then replays them.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new TelemetryConsoleLogger(app.get(TelemetryLogWatcher)));
  await app.listen(3000);
}
bootstrap();
```

Every `Logger` instance in your app (`new Logger(MyService.name)`) now prints and records.

## Filter by context

Set `basePackage` to record only the lines whose context starts with a given string:

```ts
TelemetryModule.forRoot({ basePackage: 'Orders' });
```

With that, `new Logger('OrdersService').log(...)` is recorded and Nest's own `RouterExplorer` or `InstanceLoader` lines are not. A line without a context is always recorded. The comparison is a plain, case-sensitive `startsWith`.

## Limitations

:::warning[Current limitation]
Calling the watcher directly, without the wrapper above:

- `logger.error(err)` with an `Error` object records `{}`: the message and stack are lost.
- A message that cannot be serialized (a `BigInt`, a circular object) throws a `TypeError` back into the code that logged it.
- With `basePackage` set, a call whose second argument is not a string (`logger.log('saved', { id })`) throws a `TypeError` into your code.
- `fatal()` and `setLogLevels()` are not implemented, and messages are stored whole, with no size limit and no masking.
:::

- The dashboard's log detail panel does not show the `context` or the `trace` (it reads other field names); the list shows level and message.
- Lines logged by middleware, guards or exception filters run outside the request's batch and are not linked to it.
- The `watchers.logs` switch is not read: to stop recording logs, stop forwarding them.
