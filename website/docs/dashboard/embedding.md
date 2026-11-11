---
title: Serving and embedding the dashboard
description: How the dashboard page is served, how it finds its API and passes the token, what it loads from CDNs, and how to run it behind a proxy or next to a response-wrapping interceptor.
---

## How the page is served

`GET {basePath}` answers with `dist/dashboard/index.html` from the package, read from disk on each request and sent with the Express response API (`res.type('text/html').send(...)`). It is plain HTML with an Alpine.js app inline; there is no build step and no server-side rendering.

## How it finds its API

The page computes its API base when it loads:

```js
const base = window.__TELEMETRY_BASE_PATH__ || window.location.pathname.replace(/\/+$/, '');
const apiBase = base + '/api';
```

So by default the API is "the path this page was served from, plus `/api`". That follows any `basePath` and any global prefix with no configuration. If your setup serves the page under a different path than the API (a proxy that rewrites one but not the other), define `window.__TELEMETRY_BASE_PATH__` before the page's script runs, for example from a page of your own that embeds a copy of the HTML.

## How the token travels

The page reads `token` from its own query string and sends it as the `x-telemetry-token` header on every API call. It never puts the token in API URLs. See [Access token and security](../configuration/security.md).

## What it loads

| Asset | From |
| --- | --- |
| Tailwind CSS (play CDN script, unpinned) | `https://cdn.tailwindcss.com` |
| Alpine.js 3.14.9 | `https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js` |

Neither has an integrity attribute. Consequences:

- **No internet, no dashboard**: on an offline machine the page loads unstyled and inert.
- **Content-Security-Policy**: the page needs inline scripts, Alpine's `eval`-based expressions, styles injected by Tailwind, and both CDN hosts. A strict policy (helmet's default, for example) leaves it blank. Relax the policy for the dashboard path only:

```ts title="src/main.ts"
import helmet from 'helmet';

const strict = helmet();
const forDashboard = helmet({
  contentSecurityPolicy: {
    directives: {
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net'],
      'style-src': ["'self'", "'unsafe-inline'"],
    },
  },
});

app.use((req, res, next) => (req.path.startsWith('/telemetry') ? forDashboard : strict)(req, res, next));
```

## Behind a reverse proxy

Proxy the dashboard path and everything under it to the app unchanged and the page works as is. If the proxy rewrites paths (`/tools/telemetry` outside, `/telemetry` inside), the page computes its API from the outside path, which the proxy also forwards, so it keeps working as long as both the page and `/api/...` go through the same rewrite. Restrict the path to your network at the proxy, with a rule that ignores case.

## Apps that wrap every response

Many apps register a global interceptor that wraps responses, as in the NestJS documentation's `TransformInterceptor`:

```ts
return next.handle().pipe(map((data) => ({ data })));
```

That interceptor also wraps the telemetry API, whose answers already have their own envelope (`{ success, message, data }`). The page then finds its data one level too deep and shows nothing. Let the telemetry controller through:

```ts title="src/common/transform.interceptor.ts"
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs/operators';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    // The telemetry dashboard expects its controller's own envelope.
    if (context.getClass().name === 'TelemetryController') return next.handle();
    return next.handle().pipe(map((data) => ({ data })));
  }
}
```

The controller class is not exported by the package, so compare its name, or the request path. The same applies to anything else that rewrites responses for every route: serializers, response-shaping filters, or a global `ClassSerializerInterceptor` with options that change plain objects.
