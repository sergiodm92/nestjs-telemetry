---
title: Schedules
description: Record scheduled job runs with TelemetryScheduleWatcher.wrap(), and link everything a run does to it.
---

`TelemetryScheduleWatcher.wrap()` runs a function and records a `SCHEDULE` entry for it: how long it took and whether it failed. Use it in the body of your `@Cron`, `@Interval` and `@Timeout` methods.

:::warning[Current limitation]
Scheduled jobs are not captured on their own: the watcher does not hook into `@nestjs/schedule`. A job appears in the dashboard only when its body goes through `wrap()`.
:::

## Wrap a job

```ts title="src/reports/reports.task.ts"
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TelemetryScheduleWatcher } from '@nestjs-telemetry/core';
import { ReportsService } from './reports.service';

@Injectable()
export class ReportsTask {
  constructor(
    private readonly schedules: TelemetryScheduleWatcher,
    private readonly reports: ReportsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  sendHourlyReport() {
    return this.schedules.wrap(ReportsTask.name, 'sendHourlyReport', () => this.reports.sendHourly());
  }
}
```

The signature is `wrap(className: string, methodName: string, fn: () => Promise<any>): Promise<any>`. It returns what `fn` resolves to, and re-throws what it throws, after recording.

## What an entry holds

| Field | Content |
| --- | --- |
| `class`, `method` | The names you passed. |
| `status` | `completed` or `failed`. |
| `duration` | Milliseconds. |
| `exception` | The error message of a failed run, or `''`. |

Tags: `schedule:completed` or `schedule:failed`. `userIdentifier` and `tenantId` are empty.

## Each run is a batch

`wrap()` runs `fn` inside a new batch: the queries, log lines, mail and model changes of that run share its batch ID, and the dashboard lists them under the run. The batch is new even when `wrap()` is called while handling an HTTP request: the run is then not linked to that request.

While recording is paused, `wrap()` just runs `fn`.

## In the dashboard

The Schedule view groups runs of the same class and method. A group shows the status of its newest run, so an older failure can hide behind a `completed` row: turn off **Grouped** to see every run.
