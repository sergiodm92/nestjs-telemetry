---
title: Events
description: Record application events with TelemetryEventWatcher.record(), from your listeners or from every emission at once.
---

`TelemetryEventWatcher.record()` stores an `EVENT` entry: the event name, its payload and the handler that received it.

:::warning[Current limitation]
Events are not captured on their own: the watcher does not hook into `@nestjs/event-emitter`. An event appears in the dashboard only when your code calls `record()`.
:::

## Record from a listener

```ts title="src/orders/order-created.listener.ts"
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TelemetryEventWatcher } from '@nestjs-telemetry/core';
import { OrderCreatedEvent } from './order-created.event';

@Injectable()
export class OrderCreatedListener {
  constructor(private readonly events: TelemetryEventWatcher) {}

  @OnEvent('order.created')
  async handle(event: OrderCreatedEvent) {
    await this.events.record('order.created', event, OrderCreatedListener.name, 'handle');
    // ...your handling
  }
}
```

The signature is `record(eventName: string, payload: any, handlerClass: string, handlerMethod: string): Promise<void>`.

## Record every emission

To see every event without touching each listener, record emissions instead, with `EventEmitter2.onAny()`:

```ts title="src/telemetry/event-recorder.ts"
import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TelemetryEventWatcher } from '@nestjs-telemetry/core';

@Injectable()
export class EventRecorder implements OnModuleInit {
  constructor(
    private readonly emitter: EventEmitter2,
    private readonly events: TelemetryEventWatcher,
  ) {}

  onModuleInit() {
    this.emitter.onAny((event, payload) => {
      void this.events.record(String(event), payload, 'EventEmitter2', 'emit');
    });
  }
}
```

`onAny` listeners run synchronously inside `emit()`, so an event emitted while handling a request carries that request's batch ID.

## What an entry holds

| Field | Content |
| --- | --- |
| `event` | The event name. |
| `eventClass` | The payload's constructor name (`OrderCreatedEvent`, `Object`, `Array`), or `''` for a primitive. |
| `payload` | The payload after a JSON round trip: dates become strings, functions and `undefined` disappear. A primitive is stored as `{ value }`, `null` or `undefined` as `{}`. |
| `handlerClass`, `handlerMethod` | The names you passed. |

Tags: `event:<name>`.

## Limitations

- A payload that cannot be serialized (a `BigInt` anywhere in it, a circular reference) is replaced as a whole by `{ toString: String(payload) }`.
- Payloads are stored whole: no size limit and no masking. Do not record events that carry secrets or large buffers.
- The dashboard's Events list shows the event name but not the handler (it reads a field the watcher does not write); the detail panel shows the payload.
- The `watchers.events` switch is not read.
