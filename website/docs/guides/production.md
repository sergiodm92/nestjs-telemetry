---
title: Production checklist
description: Whether to run NestJS Telemetry outside development, and what to set up first if you do - access, network, data, memory, disk and overhead.
---

NestJS Telemetry is built for development and staging. It records request bodies, SQL parameters, log lines and mail, and its dashboard can delete data. Read this page before it runs anywhere real users reach.

## First: do you need it there?

The safest production setup is none: install the package as a development dependency and register the module only outside production, as shown in [Development-only setup](../getting-started/installation.md#development-only-setup). Use a staging environment with test data for shared debugging.

## If it runs in a shared or production environment

### Access

- [ ] Set `accessToken` from a secret, read so that a missing value stops the boot (`getOrThrow()`). See [Access token and security](../configuration/security.md).
- [ ] Use a version after 0.2.3: up to 0.2.3 the token could be skipped with a case variant of the URL, under a global prefix without `externalBasePath`, and on Fastify.
- [ ] Block the dashboard path at the proxy for everyone outside your network, with a rule that ignores case, since Express routes `/TELEMETRY` to the dashboard too.
- [ ] Serve it over HTTPS only, and mask `token=` in proxy and access logs.

### Data

- [ ] Review [what is not masked](../concepts/data-masking.md#what-is-not-masked): SQL parameters, Prisma arguments, exception messages, log lines, event payloads, mail addresses, URL paths, header values under innocent names.
- [ ] Turn off what you do not need: `watchers: { cache: false }` (the cache watcher only guesses), and do not wire logs, events or ORM watchers you will not read.
- [ ] Add paths you never want recorded (`/auth`, webhooks with signed payloads) to `ignoredPrefixes`, remembering they are plain string prefixes compared with the full path.

### Memory and disk

- [ ] **Memory storage**: up to `maxEntries` entries per type, nine types. A request entry can hold two 10 KB bodies plus headers, a mail entry 50 KB of HTML. With the defaults, plan for tens of megabytes; lower `maxEntries` on small containers.
- [ ] **SQLite storage**: nothing caps the file but pruning. Set `pruneHours` to what you need, put the file on a persistent volume, and do not use a filtered search on a very large database: it scans the whole type synchronously.
- [ ] Never let a `BigInt` reach an entry with SQLite (Prisma or TypeORM `bigint` ids): it stops all writes. See [Storage](../configuration/storage.md).

### Overhead

- [ ] Each request: one entry, the response copied (up to 256 KB) and masked, headers and body masked. Usually well under a millisecond, but large JSON responses cost a parse and a serialization.
- [ ] Each open dashboard tab: three API calls every five seconds.
- [ ] GraphQL or microservice transports in the same app: do not import the module there yet (see [Requests](../watchers/requests.md#other-transports)).

### Operations

- [ ] Watch `GET {basePath}/api/status`: the recording flag, counts per type, and storage size (`bufferSize` growing on SQLite means writes are failing).
- [ ] Remember the dashboard's **Enabled** button pauses recording for the whole app, and **Clear all** and **Prune** delete data for everyone.
- [ ] Each instance has its own entries; a load-balanced dashboard shows a different instance on each refresh.
