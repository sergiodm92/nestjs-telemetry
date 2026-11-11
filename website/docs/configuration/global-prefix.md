---
title: Global prefix and externalBasePath
description: How app.setGlobalPrefix() moves the dashboard, why the request watcher needs externalBasePath to leave the dashboard's own calls out, and the alternative of excluding the dashboard from the prefix.
---

`basePath` is the path the module registers its controller at, through `RouterModule`. `app.setGlobalPrefix()` is applied on top of every registered route afterwards, so with a global prefix the dashboard is no longer where `basePath` says.

## Where the dashboard ends up

| `main.ts` | `basePath` | Dashboard page | JSON API |
| --- | --- | --- | --- |
| no prefix | `/telemetry` | `/telemetry` | `/telemetry/api/...` |
| `app.setGlobalPrefix('api')` | `/telemetry` | `/api/telemetry` | `/api/telemetry/api/...` |
| `app.setGlobalPrefix('api/v1')` | `/admin/telemetry` | `/api/v1/admin/telemetry` | `/api/v1/admin/telemetry/api/...` |

The page finds its API by itself: it takes the path it was served from, drops a trailing slash and appends `/api`. Nothing needs configuring for the page to work under a prefix.

## Why externalBasePath exists

The request watcher skips the dashboard's own calls, so they do not fill the Requests view. It recognises them by their path: the ones that start with `externalBasePath` when it is set, and with `basePath` otherwise. Under a prefix, requests carry `/api/telemetry/...`, which does not start with `/telemetry`, so without `externalBasePath` every call the dashboard makes (three every five seconds) is recorded as a request.

The access token does not depend on it. The guard is bound to the dashboard's routes, so the token is asked under the prefix with or without `externalBasePath` (see [Where the token is checked](./security.md#where-the-token-is-checked)).

Set `externalBasePath` to the full path:

```ts title="src/app.module.ts"
TelemetryModule.forRoot({
  basePath: '/telemetry',
  externalBasePath: '/api/telemetry',
  accessToken: process.env.TELEMETRY_TOKEN ?? '',
});
```

```ts title="src/main.ts"
app.setGlobalPrefix('api');
```

Write both values with a leading slash and without a trailing one: the request watcher compares them as plain string prefixes.

## Alternative: keep the dashboard out of the prefix

Instead of following the prefix, you can exclude the dashboard routes from it. Requests then carry `basePath` again, and `externalBasePath` is not needed:

```ts title="src/main.ts"
import { RequestMethod } from '@nestjs/common';

app.setGlobalPrefix('api', {
  exclude: [
    { path: 'telemetry', method: RequestMethod.ALL },
    { path: 'telemetry/(.*)', method: RequestMethod.ALL },
  ],
});
```

The dashboard stays at `/telemetry` while the rest of the app moves to `/api`. On NestJS 11 the `(.*)` wildcard is the legacy syntax: Nest converts it and logs a deprecation warning; the new form is `telemetry/*path`.

## ignoredPrefixes under a prefix

`ignoredPrefixes` is compared with the path as requests carry it, prefix included. With `app.setGlobalPrefix('api')`, write `/api/health`, not `/health`.

## Serving the page from somewhere else

When a reverse proxy rewrites paths, the browser's address no longer matches what the app sees. The page then needs to be told where its API is: see [Serving and embedding the dashboard](../dashboard/embedding.md).
