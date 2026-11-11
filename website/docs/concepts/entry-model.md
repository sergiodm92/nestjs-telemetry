---
title: Entry model
description: The TelemetryEntry interface, the nine entry types, their tags, and the content fields each watcher writes.
---

## TelemetryEntry

```ts
interface TelemetryEntry {
  uuid: string;               // unique id
  type: TelemetryEntryType;   // one of the nine types
  createdAt: Date;            // when it was recorded
  batchId: string;            // request or run it belongs to, or ''
  content: Record<string, any>;
  userIdentifier: string;     // or ''
  tenantId: string;           // or ''
  tags: string[];
}
```

`TelemetryEntryType` is a string enum: `REQUEST`, `EXCEPTION`, `QUERY`, `LOG`, `SCHEDULE`, `CACHE`, `EVENT`, `MAIL`, `MODEL`.

The SQLite storage keeps `content` and `tags` as JSON text and `createdAt` as an ISO-8601 string, and turns them back into objects and a `Date` when it reads. The in-memory storage keeps the objects themselves, and returns them by reference: treat entries you read as read-only.

## Content by type

### REQUEST

| Field | Type | Notes |
| --- | --- | --- |
| `method` | string | |
| `uri` | string | Path (Express `req.path`) |
| `queryString` | string | Masked |
| `status` | number | Final status |
| `duration` | number | ms |
| `ipAddress` | string | |
| `contentType`, `responseContentType` | string | |
| `requestHeaders`, `responseHeaders` | object | Masked |
| `requestBody`, `responseBody` | string | Masked, at most 10,000 characters |

Tags: none.

### EXCEPTION

| Field | Type | Notes |
| --- | --- | --- |
| `class` | string | Constructor name |
| `message` | string | Not masked |
| `trace` | string | At most 5,000 characters |
| `file`, `line`, `location` | string | First stack frame |
| `uri`, `method` | string | The request |
| `cause` | string | `String(error.cause)` |

Tags: `exception:<Class>`.

### QUERY

TypeORM: `sql`, `type` (`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`DDL`/`OTHER`), `duration`, `parameters`.
Prisma: `model`, `action`, `type`, `duration`, `args`, `error`.

Tags: `query:<type>`.

### LOG

`level` (`LOG`/`ERROR`/`WARN`/`DEBUG`/`VERBOSE`), `message`, `context`, `trace`. Tags: `log:<level>`.

### SCHEDULE

`class`, `method`, `status` (`completed`/`failed`), `duration`, `exception`. Tags: `schedule:<status>`.

### CACHE

`operation` (`HIT`/`MISS`), `cacheName` (`''`), `key`, `duration`. Tags: `cache:<operation>`.

### EVENT

`event`, `eventClass`, `payload`, `handlerClass`, `handlerMethod`. Tags: `event:<name>`.

### MAIL

Always: `to`, `from`, `subject`, `type`, `bodyPreview`, `status` (`sent`/`failed`), `source`.
When present: `cc`, `bcc`, `replyTo`, `html`, `htmlTruncated`, `text`, `template`, `attachments` (`{ filename, contentType, size? }[]`), `error`, `duration`, `messageId`, `accepted`, `rejected`, `transport`.

Tags: `mail`, `to:<address>` per recipient, `mail:failed`.

### MODEL

TypeORM: `entity`, `action` (`CREATED`/`UPDATED`/`DELETED`), `entityId`, `changedFields`.
Prisma: `entity`, `action`, `entityId`, `data`.

Tags: `model:<action>`, `entity:<Name>`.

## Recording your own entries

The storage is injectable through `TELEMETRY_STORAGE`, so you can store entries of the existing types yourself, as the [Cache](../watchers/cache.md) and [Prisma](../integrations/prisma.md) recipes do. Use one of the nine types (the dashboard has no view for others), check `storage.isEnabled()` first, read the batch from `TelemetryContext`, and keep `content` JSON-serializable: no `BigInt`, no cycles.
