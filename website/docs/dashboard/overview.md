---
title: Using the dashboard
description: A tour of the dashboard - the home view, the list views, filters, grouping, the entry detail and related entries, recording, clearing and pruning.
---

The dashboard is a single page served by your application at `basePath` (`/telemetry` by default). It reads everything through the [REST API](../reference/rest-api.md) and refreshes on its own every five seconds.

If you set an access token, open it as `/telemetry?token=<token>`; the page sends the token with every call it makes.

## Layout

- **Sidebar**: the home view and one view per entry type (Requests, Exceptions, Queries, Logs, Schedule, Cache, Events, Mail, Models), each with its count. At the bottom, **Recording** or **Paused**.
- **Top bar** of a list view: the user and tenant filters, the method and status filters (Requests only), the search box, and the **Auto**, **Grouped**, **Enabled** and **Clear all** buttons.
- **Detail panel**: opens on the right when you click an entry.

## Home

One card per entry type with its count (click a card to open the view), a **Prune entries older than 24h** button, and the ten most recent requests.

## List views

Each view lists the entries of one type, newest first, 50 per page; when there are more, a pager shows "Showing 1-50 of N".

| View | Each row shows |
| --- | --- |
| Requests | Method, path, status (colored by class), duration, time |
| Exceptions | Class, message, location and method |
| Queries | Statement type and the SQL (first 120 characters) |
| Logs | Level and message |
| Schedule | Class, method, status, duration |
| Cache | Operation, cache name, key, duration |
| Events | Event name |
| Mail | A **FAILED** badge when it failed, subject, recipients, time |
| Models | Action, entity, id, changed fields |

### Filters and search

- **User** and **Tenant** list every user identifier and tenant id recorded so far, and filter every view by them.
- **Method** and **Status** (`2xx`...`5xx`) filter requests.
- **Search** matches, ignoring case, any top-level field of an entry's content. It runs 300 ms after you stop typing. Nested data (headers, payloads, arguments) is not searched.

Changing view resets the search and the method and status filters; the user and tenant filters stay.

### Grouping

With **Grouped** on (the default), identical entries are folded into one row with a `xN` badge; click the badge to expand the group. What counts as identical depends on the type:

| Type | Grouped by |
| --- | --- |
| Request | Method, path and status |
| Exception | Class and message |
| Query | SQL |
| Log | Level, logger and message |
| Schedule | Class and method |
| Cache | Operation, cache name and key |
| Event | Event name and payload class |
| Mail | Subject and recipients |
| Model | Action, entity class and id |

Grouping is applied to the current page only.

## The entry detail

The panel shows the content of the entry in sections suited to its type: headers and bodies of a request, the stack of an exception, the formatted SQL of a query, the rendered HTML of a mail, and so on. Copy buttons put a section on the clipboard.

Below, **Related entries (same request)** lists everything recorded with the same batch ID: the queries, logs, mail and exceptions of that request, in the order they happened. Click one to open it. The panel ends with the entry's UUID, time, batch ID and tags.

## Controls

| Control | What it does |
| --- | --- |
| **Auto** | Turns the five-second refresh on and off. |
| **Grouped** | Turns grouping on and off. |
| **Enabled** / **Disabled** | Pauses or resumes recording for the whole application (`POST /api/toggle`). Paused watchers store nothing; existing entries stay. |
| **Clear all** | After a confirmation, deletes every entry **of the current view's type** (`DELETE /api/entries?type=...`). |
| **Prune entries older than 24h** | Deletes entries older than 24 hours, whatever `pruneHours` is (`POST /api/prune?hours=24`). |

## Limitations

:::warning[Current limitation]
- The page does not read the recording state when it loads: it shows **Enabled**/**Recording** even if recording was paused, and the first click then reports the real state.
- After a search or a clear, the page number is kept, so you can land on an empty page with no pager; change view to reset it.
- Some fields are not shown: a log's context and stack, an event's handler, a model's entity name in the detail panel. Prisma queries appear as blank rows in the Queries view. The data is in the entry (see it through the API).
- Copy buttons need a secure context: they work on `localhost` and over HTTPS, not on plain HTTP to another host.
- A slow answer for a previous view or page can briefly replace the current one.
:::
