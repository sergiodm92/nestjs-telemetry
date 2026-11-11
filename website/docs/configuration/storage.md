---
title: Storage
description: How the in-memory and SQLite storages keep entries, when buffered entries become visible, how pruning works, and how to choose between them.
---

Entries go to one storage, chosen with the `storage` option. Both implement the same `TelemetryStorage` interface, so the dashboard and the watchers behave the same on either; the differences are durability, limits and cost.

| | `'memory'` (default) | `'sqlite'` |
| --- | --- | --- |
| Survives a restart | No | Yes |
| Size limit | `maxEntries` per type | None besides pruning |
| Write path | Immediate | Buffered, flushed every `flushIntervalMs` |
| Shared between processes | No | One file per process; not designed for several writers |
| Native module | No | `better-sqlite3` |

## In memory

`InMemoryTelemetryStorage` keeps one array per entry type, newest first. When a type already holds `maxEntries` entries, storing a new one drops the oldest of that type. Nothing is written anywhere: a restart starts empty, and each instance of a scaled-out app has its own entries.

Reads filter the arrays directly:

- `userIdentifier` and `tenantId` must be equal (strict comparison).
- `method` compares `content.method`, ignoring case; `statusGroup` (`2xx`...`5xx`) compares the hundreds of `content.status`. Entries without those fields never match.
- `search` matches, ignoring case, any **top-level** value of `content` converted with `String()`. A nested object becomes `[object Object]`, so text inside headers, payloads or arguments is not found.
- Pages are cut after filtering, so the total and the pages agree.

:::note
Each type is capped separately: the default allows up to 9,000 entries in total. A `REQUEST` entry can hold two bodies of up to 10 KB each and its headers; a `MAIL` entry up to 50 KB of HTML. Budget memory accordingly.
:::

## SQLite

`SqliteTelemetryStorage` uses `better-sqlite3` with WAL journaling and `synchronous = NORMAL`. It creates one table on first use:

```sql
CREATE TABLE IF NOT EXISTS telemetry_entries (
  uuid TEXT PRIMARY KEY, type TEXT NOT NULL, created_at TEXT NOT NULL,
  batch_id TEXT NOT NULL, content TEXT NOT NULL,
  user_identifier TEXT NOT NULL, tenant_id TEXT NOT NULL, tags TEXT NOT NULL
);
-- plus one index each on type, created_at, batch_id, user_identifier and tenant_id
```

`content` and `tags` are stored as JSON text and `created_at` as an ISO-8601 string; reads turn them back into objects and `Date`s.

### The write buffer

Storing an entry only appends it to an in-process buffer. The buffer is written to the database:

- every `flushIntervalMs` (2 seconds by default), by the pruner service;
- before every listing, count, related-entries, tags or filter-options read, so the dashboard always sees what was stored;
- when the module is destroyed (`app.close()`);
- on `POST {basePath}/api/flush`.

A flush writes up to 200 entries per transaction, repeating until the buffer is empty. `INSERT OR IGNORE` makes a replayed entry harmless.

Filters on `userIdentifier` and `tenantId` run in SQL. The others (`method`, `statusGroup`, `search`) run in JavaScript after loading every row of the type.

:::warning[Current limitation]
- **Filtered reads load the whole type.** With a method, status or search filter, each dashboard refresh reads and parses every stored row of that type, twice (page and total). `better-sqlite3` is synchronous, so on a large database this blocks your application's event loop for seconds. Keep the database small with pruning.
- **One unserialisable entry stops all writes.** If an entry's content cannot be turned into JSON (a `BigInt`, for example a Prisma or TypeORM `bigint` id), its batch is put back in the buffer and every later flush fails on it: nothing more is written, reads answer `500`, the buffer grows, and `app.close()` rejects.
- **No size limit.** `maxEntries` does not apply; only pruning removes rows.
- **The connection is never closed** by the module at shutdown.
:::

## Pruning

`TelemetryPrunerService` starts two timers when the module is created:

| Timer | Interval | Does |
| --- | --- | --- |
| Prune | `pruneIntervalMs` (1 h) | Deletes every entry created more than `pruneHours` (24) hours ago, buffer included. |
| Flush | `flushIntervalMs` (2 s) | Writes the SQLite buffer (does nothing in memory). |

On `app.close()` both timers are cleared and the buffer is flushed. Errors in either timer are logged and do not stop it.

You can also prune on demand: `POST {basePath}/api/prune?hours=N` deletes entries older than N hours (`hours=0` is treated as 24), and the dashboard's **Prune** button calls it with 24 hours. See the [REST API](../reference/rest-api.md).

:::note
The timers are not `unref()`ed: a script that creates an application context and never closes it does not exit on its own. Call `app.close()`.
:::

## Choosing

- Use **memory** for local development and tests: nothing to clean up, and the cap keeps memory bounded.
- Use **SQLite** when entries must survive restarts (a staging server, a long debugging session), with a `pruneHours` that keeps the file small, and keep its files out of version control:

```text title=".gitignore"
.telemetry.db*
```

Neither storage is shared between instances; to look at several instances, open each one's dashboard. A third-party storage cannot be plugged in through options today: see [Custom storage](../reference/custom-storage.md).
