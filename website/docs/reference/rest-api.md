---
title: REST API
description: Every route of the telemetry controller - parameters, defaults, response shapes, errors and authentication - with curl examples.
---

The module mounts one controller at `basePath` (default `/telemetry`). The dashboard page is served at `GET {basePath}`; every JSON route is under `{basePath}/api`. Under a global prefix, both move with it: see [Global prefix](../configuration/global-prefix.md).

## Conventions

**Envelope.** Every JSON route answers:

```json
{ "success": true, "message": "ok", "data": {} }
```

**Errors.** A missing `type` or an unknown UUID answers `success: false` with **HTTP 200** and `data: null`. Unexpected failures surface as Nest's `500`.

**Authentication.** With `accessToken` set, every route (the page included) needs the token, in the `x-telemetry-token` header or the `token` query parameter. Without it the answer is `403`. See [Access token and security](../configuration/security.md).

```bash
export T=your-token
curl -H "x-telemetry-token: $T" http://localhost:3000/telemetry/api/stats
```

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `{basePath}` | The dashboard page (HTML) |
| `GET` | `/api/entries` | List entries of one type |
| `GET` | `/api/entries/:uuid` | One entry |
| `GET` | `/api/entries/:uuid/related` | Entries of the same batch |
| `GET` | `/api/filters` | Values for the filter dropdowns |
| `GET` | `/api/stats` | Count per type |
| `GET` | `/api/status` | Recording flag, counts and storage info |
| `GET` | `/api/tags` | Every distinct tag |
| `GET` | `/api/memory` | Storage info |
| `POST` | `/api/toggle` | Pause or resume recording |
| `POST` | `/api/flush` | Write the SQLite buffer now |
| `POST` | `/api/prune` | Delete entries older than N hours |
| `POST` | `/api/prune/expired` | Same, reported as retention |
| `DELETE` | `/api/entries` | Delete entries of one type, or all |

Paths below are relative to `{basePath}`.

### GET /api/entries

| Query parameter | Default | Meaning |
| --- | --- | --- |
| `type` | required | `REQUEST`, `EXCEPTION`, `QUERY`, `LOG`, `SCHEDULE`, `CACHE`, `EVENT`, `MAIL` or `MODEL`. |
| `page` | `0` | Zero-based page. |
| `size` | `50` | Page size. Not capped. |
| `userIdentifier`, `tenantId` | | Exact match. |
| `method` | | Matches `content.method`, ignoring case. |
| `statusGroup` | | `2xx`, `3xx`, `4xx` or `5xx`, on `content.status`. |
| `search` | | Case-insensitive substring of any top-level content field. |

```bash
curl -H "x-telemetry-token: $T" "http://localhost:3000/telemetry/api/entries?type=REQUEST&statusGroup=5xx&size=20"
```

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "total": 2,
    "entries": [
      {
        "uuid": "1e0c...",
        "type": "REQUEST",
        "createdAt": "2026-11-10T14:03:58.120Z",
        "batchId": "a489...",
        "content": { "method": "GET", "uri": "/orders/7", "status": 500, "duration": 12 },
        "userIdentifier": "ana@example.com",
        "tenantId": "",
        "tags": []
      }
    ]
  }
}
```

`total` counts every entry matching the filters, for paging. Entries are newest first. Content fields per type: [Entry model](../concepts/entry-model.md).

:::warning
`size` is not capped and `size=-1` returns everything on SQLite. On a large SQLite database, `method`, `statusGroup` and `search` load the whole type into memory: see [Storage](../configuration/storage.md).
:::

Without `type`: `{ "success": false, "message": "type parameter is required", "data": null }`.

### GET /api/entries/:uuid

The entry as `data`, or `{ "success": false, "message": "Entry not found", "data": null }`.

### GET /api/entries/:uuid/related

Every entry with the same `batchId`, oldest first. An unknown entry, or one without a batch, answers `data: []`.

### GET /api/filters

```json
{
  "users": [{ "id": "ana@example.com", "name": "ana@example.com" }],
  "tenants": [{ "id": "t1", "name": "t1" }],
  "methods": ["GET", "POST", "PUT", "PATCH", "DELETE"],
  "statuses": ["2xx", "3xx", "4xx", "5xx"]
}
```

`users` and `tenants` are the distinct values recorded so far, sorted.

### GET /api/stats

A count per type, every type present: `{ "REQUEST": 12, "EXCEPTION": 1, "QUERY": 40, ... }`. On SQLite it includes buffered entries.

### GET /api/status

```json
{ "enabled": true, "stats": { "REQUEST": 12 }, "memory": { "type": "memory", "totalEntries": 53, "maxEntriesPerType": 1000, "enabled": true } }
```

### GET /api/memory

The `memory` object above. In memory: `type`, `totalEntries`, `maxEntriesPerType`, `enabled`. On SQLite: `type: "sqlite"`, `bufferSize`, `dbEntries`, `totalEntries`, `enabled`.

### GET /api/tags

Every distinct tag, sorted: `["cache:miss", "exception:TypeError", "mail", "to:ana@example.com"]`.

### POST /api/toggle

Flips the recording flag and answers `{ "enabled": false }`. While paused no watcher stores anything. It takes no body: two calls cancel out.

### POST /api/flush

Writes the SQLite buffer now; answers `message: "Buffer flushed"` and the memory info. Nothing to do in memory.

### POST /api/prune

| Query parameter | Default |
| --- | --- |
| `hours` | `24` |

Deletes every entry created more than `hours` ago and answers `{ "pruned": 37, "hours": 24 }`. `hours=0` (or anything that is not a positive number) is treated as `24`.

`POST /api/prune/expired` does the same and answers `{ "pruned": 37, "retentionHours": 24 }`.

### DELETE /api/entries

With `?type=MAIL`, deletes the entries of that type; without `type`, deletes **everything**. Answers `message: "Entries cleared"`, `data: null`.

```bash
curl -X DELETE -H "x-telemetry-token: $T" "http://localhost:3000/telemetry/api/entries?type=CACHE"
```

:::note
The state-changing routes have no CSRF protection beyond the token. Without a token, any web page a developer visits can send these requests to a dashboard on `localhost`.
:::
