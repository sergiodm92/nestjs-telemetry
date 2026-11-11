---
title: Requests
description: What the request watcher records for each HTTP request, when it records it, how responses are captured and masked, and which requests it never sees.
---

`TelemetryRequestInterceptor` is bound as a global interceptor (the outermost of the three the module binds) and records one `REQUEST` entry per HTTP request.

## When an entry is written

The entry is written when the response ends: on the Node response's `finish` event, or `close` if the connection closed first. That is the only moment the final status code is known: Nest sets `200`/`201` before the handler runs, and an exception filter writes the real `4xx`/`5xx` after every interceptor has seen the error. If the response object cannot be observed, the entry is written when the handler settles instead.

## What is recorded

| Field | Content |
| --- | --- |
| `method` | HTTP method. |
| `uri` | `req.path` (Express), or `req.url` when there is no `path`. |
| `queryString` | The query string, with sensitive parameters masked. |
| `status` | `res.statusCode` when the response ended. |
| `duration` | Milliseconds from the interceptor to the end of the response. |
| `ipAddress` | `req.ip`, or the socket's remote address. |
| `contentType`, `responseContentType` | Request and response `Content-Type`. |
| `requestHeaders`, `responseHeaders` | Every header, sensitive ones masked. |
| `requestBody` | The parsed body serialized and masked, then cut at 10,000 characters. A raw `Buffer` body is stored as `[binary body omitted]`. |
| `responseBody` | A copy of what was sent, masked, cut at 10,000 characters (rules below). |

The entry also gets the request's `batchId`, `userIdentifier` and `tenantId`. Its `tags` are empty.

## Response capture

The watcher wraps the response's `write` and `end` to copy what is sent, without changing it: the client always receives exactly what the handler or filter produced.

- Only text is kept: `application/json`, `application/xml`, `+json`/`+xml` types, and `text/*` except `text/event-stream`.
- A compressed response (`Content-Encoding` other than `identity`), a UTF-16 or UTF-32 charset, or binary content is stored as `[non-text response omitted]`.
- A response without a content type is kept only if it parses as JSON.
- More than 256 KB is not recorded: `[response larger than 256 KB, not recorded]`.
- `HEAD`, `204` and `304` responses have no body to record.
- A connection that closed before the response finished is marked `[response incomplete: the connection closed first]`.

JSON is parsed and written back to be masked, so a number beyond 2^53 loses digits and a duplicated key collapses in the recorded copy. Masking rules: [Data masking](../concepts/data-masking.md).

## Who made the request

At the start of each request the watcher asks the user provider for the current user. The default, `DefaultTelemetryUserProvider`, reads `req.user`:

- `userIdentifier` is the first of `email`, `username`, `id` and `sub` that is set, or `String(user)`;
- `tenantId` is `req.user.tenantId`.

Interceptors run after guards, so a user set by a Passport guard is visible. There is no option to replace the user provider.

:::warning[Current limitation]
Identifiers are stored as they are. A numeric `id` or `tenantId` (or a user object without any of the four fields, recorded as `[object Object]`) makes the dashboard's user and tenant filters match nothing on the in-memory storage, because they compare a string from the query with a number.
:::

## Requests that are not recorded

- Paths that start with the dashboard path (`externalBasePath` or `basePath`) or with one of `ignoredPrefixes`. Both are plain string prefixes: `/health` also skips `/healthcare`.
- Requests that never reach an interceptor: rejected by a guard (`401`/`403`), matching no route (`404`), or failing in middleware. They leave no `REQUEST` and no `EXCEPTION` entry.
- Everything while recording is paused.

The duration starts at the interceptor, so time spent in middleware and guards is not included.

## Other transports

:::warning[Current limitation]
The interceptor assumes an HTTP request on every route. In an app that also exposes GraphQL resolvers, each top-level resolver fails with a `TypeError` while the module is imported; microservice (RPC) handlers produce `REQUEST` entries with no method or path. Under Fastify, `uri` holds the raw URL with its query string, which is not masked there.
:::

## Turning it off

`watchers: { requests: false }` binds a pass-through instead. That also removes the batch context of every request: see [Watcher toggles](../configuration/watchers.md).
