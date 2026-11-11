---
title: Prisma
description: Record Prisma queries and model changes, which Prisma versions the shipped middlewares work with, and a client extension for Prisma 6.14 and later.
---

`@nestjs-telemetry/prisma` ships two Prisma middlewares: one records every operation as a `QUERY` entry, the other records writes as `MODEL` entries.

:::danger[Prisma 6.14 and later]
The middlewares are registered with `prisma.$use()`, which Prisma deprecated in 4.16 and **removed in 6.14** (it is not in Prisma 7 either). The package's peer range (`^5.0.0 || ^6.0.0`) accepts versions where `this.$use` is not a function and your `PrismaService` fails to start. The middlewares work with Prisma 5 and 6.0 to 6.13; the repository tests them with Prisma 5. For later versions, use the [client extension below](#prisma-614-and-later-a-client-extension).
:::

## With Prisma 5 and 6.0 to 6.13

```bash
npm install @nestjs-telemetry/prisma
```

```ts title="src/prisma/prisma.service.ts"
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TELEMETRY_STORAGE, TelemetryStorage } from '@nestjs-telemetry/core';
import { createTelemetryModelMiddleware, createTelemetryQueryMiddleware } from '@nestjs-telemetry/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(@Inject(TELEMETRY_STORAGE) storage: TelemetryStorage) {
    super();
    this.$use(createTelemetryQueryMiddleware(storage));
    this.$use(createTelemetryModelMiddleware(storage));
  }

  async onModuleInit() {
    await this.$connect();
  }
}
```

`TelemetryPrismaModule` is exported too, but it is an empty module: importing it does nothing.

### QUERY entries

| Field | Content |
| --- | --- |
| `model` | The Prisma model, or `Unknown` for raw queries. |
| `action` | `findMany`, `create`, `update`, `upsert`... |
| `type` | `SELECT` (find, count, aggregate, groupBy), `INSERT` (create...), `UPDATE` (update..., upsert), `DELETE` (delete...) or `OTHER`. |
| `duration` | Milliseconds. |
| `args` | The operation's arguments, copied through JSON. |
| `error` | The error message when the operation failed, else `''`. |

### MODEL entries

Recorded after a successful `create`, `createMany`, `update`, `updateMany`, `upsert`, `delete` or `deleteMany`.

| Field | Content |
| --- | --- |
| `entity` | The model. |
| `action` | `CREATED`, `UPDATED` (upsert included) or `DELETED`. |
| `entityId` | `result.id`, else `result.uuid`, else `''` (empty for the `...Many` operations). |
| `data` | `args.data`, copied through JSON. |

Tags: `model:<action>` and `entity:<Model>`.

### Limitations

:::warning[Current limitation]
- **A `BigInt` breaks your query.** The arguments are copied with `JSON.stringify`, which throws on `BigInt`. A query with a `BigInt` argument then fails with that error, and for a write the error comes after the row was committed. A `BigInt` id returned by a write ends up stored as is, which breaks the SQLite storage (see [Storage](../configuration/storage.md)).
- **Arguments are not masked**: a password or token in `data` or `where` is stored as it is.
- **The dashboard shows Prisma queries as blank rows** and groups them all together: the Queries view reads the `sql` field, which Prisma entries do not have. Open an entry to see its model, action and arguments.
- `watchers.queries` and `watchers.models` are not read.
:::

## Prisma 6.14 and later: a client extension

Until the package ships one, you can record the same entries with a Prisma client extension in your own code. The storage, the context and the entry types are public:

```ts title="src/prisma/telemetry.extension.ts"
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TelemetryContext, TelemetryEntryType, TelemetryStorage } from '@nestjs-telemetry/core';

const WRITES: Record<string, string> = {
  create: 'CREATED', createMany: 'CREATED', update: 'UPDATED', updateMany: 'UPDATED',
  upsert: 'UPDATED', delete: 'DELETED', deleteMany: 'DELETED',
};

function sqlType(operation: string): string {
  if (/^(find|count|aggregate|groupBy)/.test(operation)) return 'SELECT';
  if (operation.startsWith('create')) return 'INSERT';
  if (operation.startsWith('update') || operation === 'upsert') return 'UPDATE';
  if (operation.startsWith('delete')) return 'DELETE';
  return 'OTHER';
}

/** A JSON copy that turns BigInt into strings instead of throwing. */
function copy(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? {}, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

export function telemetryExtension(storage: TelemetryStorage) {
  const store = (type: TelemetryEntryType, content: Record<string, unknown>, tags: string[]) => {
    try {
      void storage.store({
        uuid: randomUUID(),
        type,
        createdAt: new Date(),
        batchId: TelemetryContext.getBatchId() ?? '',
        content,
        userIdentifier: TelemetryContext.getUserIdentifier() ?? '',
        tenantId: TelemetryContext.getTenantId() ?? '',
        tags,
      });
    } catch {
      // Recording must never change the query's outcome.
    }
  };

  return Prisma.defineExtension({
    name: 'nestjs-telemetry',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!storage.isEnabled()) return query(args);
          const start = Date.now();
          const type = sqlType(operation);
          let error = '';
          try {
            const result = await query(args);
            const action = WRITES[operation];
            if (action) {
              const row = result as { id?: unknown; uuid?: unknown } | null;
              const entityId = row?.id ?? row?.uuid ?? '';
              store(TelemetryEntryType.MODEL, {
                entity: model, action, entityId: typeof entityId === 'bigint' ? entityId.toString() : entityId,
                data: copy((args as { data?: unknown }).data),
              }, [`model:${action.toLowerCase()}`, `entity:${model}`]);
            }
            return result;
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
            throw err;
          } finally {
            store(TelemetryEntryType.QUERY, {
              model, action: operation, type, duration: Date.now() - start, args: copy(args), error,
            }, [`query:${type.toLowerCase()}`]);
          }
        },
      },
    },
  });
}
```

Provide the extended client from a factory, since `$extends()` returns a new client:

```ts title="src/prisma/prisma.module.ts"
import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TELEMETRY_STORAGE, TelemetryStorage } from '@nestjs-telemetry/core';
import { telemetryExtension } from './telemetry.extension';

export const PRISMA = Symbol('PRISMA');

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [TELEMETRY_STORAGE],
      useFactory: async (storage: TelemetryStorage) => {
        const client = new PrismaClient().$extends(telemetryExtension(storage));
        await client.$connect();
        return client;
      },
    },
  ],
  exports: [PRISMA],
})
export class PrismaModule {}
```

On Prisma 7, import `Prisma` and `PrismaClient` from the location your generator writes the client to. This extension is application code, not part of the package: it also fixes the `BigInt` problem above, but not masking.
