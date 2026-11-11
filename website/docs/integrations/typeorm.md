---
title: TypeORM
description: Record SQL queries and entity changes from TypeORM with @nestjs-telemetry/typeorm, what each entry holds, and its limits.
---

`@nestjs-telemetry/typeorm` attaches two TypeORM subscribers to your `DataSource`: one records every SQL query as a `QUERY` entry, the other records inserts, updates and removals as `MODEL` entries.

## Install and register

```bash
npm install @nestjs-telemetry/typeorm
```

```ts title="src/app.module.ts"
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryModule } from '@nestjs-telemetry/core';
import { TelemetryTypeOrmModule } from '@nestjs-telemetry/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({ /* your connection */ }),
    TelemetryModule.forRoot(),
    TelemetryTypeOrmModule,
  ],
})
export class AppModule {}
```

`TelemetryTypeOrmModule` injects the default `DataSource` (`@InjectDataSource()`) and the telemetry storage, and in its `onModuleInit` pushes its two subscribers onto `dataSource.subscribers`. It needs `TypeOrmModule` and `TelemetryModule` in the application.

Peer dependencies: `@nestjs/typeorm` 10 or 11 and `typeorm` `^0.3.0 || ^1.0.0`.

:::warning[Current limitation]
Queries are captured through TypeORM's `afterQuery` subscriber event, which exists from TypeORM 0.3.18. With an older 0.3.x, which the peer range accepts, no `QUERY` entry is ever recorded. Use TypeORM 0.3.18 or later.
:::

## QUERY entries

| Field | Content |
| --- | --- |
| `sql` | The SQL as sent to the driver. |
| `type` | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `DDL` (create/alter/drop) or `OTHER`. |
| `duration` | TypeORM's execution time in milliseconds (`0` when it does not report one). |
| `parameters` | The bound parameters, as they are. |

Tags: `query:<type>`, for example `query:select`. Queries that contain `telemetry_entries`, plus `SELECT 1` and `SELECT version...` health checks, are skipped.

## MODEL entries

| TypeORM event | `action` |
| --- | --- |
| `afterInsert` | `CREATED` |
| `afterUpdate` | `UPDATED`, with `changedFields` from TypeORM's `updatedColumns` |
| `afterRemove` | `DELETED` |

| Field | Content |
| --- | --- |
| `entity` | The entity's metadata name. |
| `action` | As above. |
| `entityId` | The entity's `id`, else its `uuid`, else `''`. |
| `changedFields` | Property names (updates only). |

Tags: `model:<action>` and `entity:<Name>`. These events fire for `save()`, `remove()` and the other entity-manager operations that work on entities; entities whose name contains `telemetry` or `telescope` are skipped.

## Limitations

- **Only the default DataSource** is instrumented. Queries of a named connection (`TypeOrmModule.forRoot({ name: 'reports' })`) are not recorded.
- **Failed queries look successful**: the entry has no error field and the duration TypeORM reported.
- **Ids are guessed** from `id` or `uuid`. Other primary key names, and operations without a loaded entity (a `QueryBuilder` or criteria update/delete), are recorded with an empty id; `remove(entity)` also records an empty id because TypeORM clears it.
- **Parameters are not masked**: a password hash or token bound to a query is stored as it is.
- **`watchers.queries` and `watchers.models` are not read**: to stop recording, do not import `TelemetryTypeOrmModule`.
- In the dashboard, the Models detail panel does not show the entity name, and different entities with the same id are grouped together.
