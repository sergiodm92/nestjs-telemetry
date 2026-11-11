# NestJS Telemetry

Zero-configuration, real-time debugging and observability dashboard for NestJS applications.

Drop it into any NestJS app and instantly get a visual dashboard to inspect HTTP requests, exceptions, database queries, logs, scheduled tasks, cache operations, events, and mail — all in real time.

## Quick Start

```bash
npm install @nestjs-telemetry/core
```

```typescript
import { TelemetryModule } from '@nestjs-telemetry/core';

@Module({
  imports: [TelemetryModule.forRoot()],
})
export class AppModule {}
```

Open `http://localhost:3000/telemetry` and you're done.

## Features

- **9 watcher types**: REQUEST, EXCEPTION, QUERY, LOG, SCHEDULE, CACHE, EVENT, MAIL, MODEL
- **Two storage backends**: In-memory (default) or SQLite for persistence
- **Single-page dashboard**: Alpine.js + Tailwind CSS, no build step required
- **Batch correlation**: All entries from a single HTTP request are linked via batch ID
- **Response capture**: the response body and headers are stored next to the request, so the detail of an error is visible. Only text is read (JSON, XML, `text/*`, up to 256 KB); binary, compressed, event-stream and UTF-16 responses are shown as omitted, and a larger one as not recorded. The client is always sent exactly what the handler produced: the watcher only copies. The JSON is parsed and written back to be masked, so a number beyond 2^53 loses digits and a duplicate key collapses.
- **Sensitive data masking**, on requests and responses alike: a header, query parameter or JSON field (at any depth) is masked by its name: when it contains `password`, `passwd`, `passcode`, `secret`, `token`, `apikey`, `authorization`, `cardnumber`, `cvv`, `cvc`, `privatekey`, `credential` or `twofactor` (case, `-`, `_`, `.` and spaces ignored), or is exactly `code`, `otp`, `pin`, `pwd`, `pass`, `jwt`, `auth`, `bearer` or `cookie` (except `code` in a response, where it is nearly always an error code and stays readable). A JWT is masked by its shape wherever it sits, a JSON document carried inside a string is read as one, and the query string and fragment of `Location`, `Referer` and similar headers are masked like a query string. Raw (binary) request bodies are not stored. Mail bodies are masked by shape (JWTs) and by the query string of every link in them (see [Mail](#mail)). **Not masked:** other values under an innocent name, URL paths (`/orders/track/:token`), SQL parameters and exception messages.
- **Body truncation**: Request and response bodies capped at 10KB (after masking), stack traces at 5KB
- **Access token protection**: Optional token-based security for the dashboard
- **Multi-tenancy**: Built-in userIdentifier and tenantId filtering
- **Auto-pruning**: Configurable data retention with automatic cleanup
- **ORM support**: Separate packages for TypeORM and Prisma

## Packages

| Package | Description |
|---------|-------------|
| `@nestjs-telemetry/core` | Core module with watchers, storage, API, and dashboard |
| `@nestjs-telemetry/typeorm` | TypeORM query and model change watchers |
| `@nestjs-telemetry/prisma` | Prisma query and model change middleware |

## Configuration

```typescript
TelemetryModule.forRoot({
  storage: 'memory',              // 'memory' | 'sqlite'
  sqlitePath: '.telemetry.db',    // SQLite file path
  basePath: '/telemetry',         // Dashboard and API base URL
  externalBasePath: undefined,    // Real request path, if different from basePath (see below)
  maxEntries: 1000,               // Max entries per type (in-memory)
  pruneHours: 24,                 // Auto-delete entries older than this
  pruneIntervalMs: 3600000,       // How often to run pruning (1h)
  accessToken: '',                // Protect dashboard with token
  ignoredPrefixes: ['/health', '/swagger', '/api-docs'],
  basePackage: '',                // Filter logs by context prefix
  flushIntervalMs: 2000,          // SQLite buffer flush interval
  watchers: {
    requests: true,
    exceptions: true,
    queries: true,
    logs: true,
    schedules: true,
    cache: true,
    events: true,
    mail: true,
    models: true,
  },
})
```

`externalBasePath` matters if your app calls `app.setGlobalPrefix(...)`: `basePath` is only used
to register the dashboard's route (before the prefix is applied), so the request watcher keeps
comparing against the un-prefixed path, and records the dashboard's own calls as requests, unless
you set `externalBasePath` to the real, prefixed path (e.g. `basePath: '/telemetry'`,
`externalBasePath: '/api/v1/telemetry'`). The access token does not depend on it: it is checked on
every route of the dashboard, wherever and however that route is reached.

### Async Configuration

```typescript
TelemetryModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    storage: config.get('TELEMETRY_STORAGE', 'memory'),
    accessToken: config.get('TELEMETRY_TOKEN', ''),
    basePath: config.get('TELEMETRY_PATH', '/telemetry'),
  }),
})
```

## TypeORM Integration

```bash
npm install @nestjs-telemetry/typeorm
```

```typescript
import { TelemetryModule } from '@nestjs-telemetry/core';
import { TelemetryTypeOrmModule } from '@nestjs-telemetry/typeorm';

@Module({
  imports: [
    TelemetryModule.forRoot({ watchers: { queries: true, models: true } }),
    TelemetryTypeOrmModule,
  ],
})
export class AppModule {}
```

This automatically captures SQL queries and entity changes (INSERT, UPDATE, DELETE) via TypeORM subscribers.

## Prisma Integration

```bash
npm install @nestjs-telemetry/prisma
```

```typescript
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TELEMETRY_STORAGE, TelemetryStorage } from '@nestjs-telemetry/core';
import { createTelemetryQueryMiddleware, createTelemetryModelMiddleware } from '@nestjs-telemetry/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(@Inject(TELEMETRY_STORAGE) private storage: TelemetryStorage) {
    super();
    this.$use(createTelemetryQueryMiddleware(storage));
    this.$use(createTelemetryModelMiddleware(storage));
  }

  async onModuleInit() {
    await this.$connect();
  }
}
```

## Mail

Mail needs no code in your app. When the application starts, the module looks at every provider
and instruments the `sendMail()` of each mail sender it recognises:

- a **nodemailer transporter** (`nodemailer.createTransport(...)`, any major from 6 on) that is a
  provider of its own, or that a provider keeps in one of its fields;
- the **`MailerService`** of `@nestjs-modules/mailer` (recorded once, with its template name, even
  though it sends through nodemailer itself).

```typescript
// Both of these are picked up as they are:
@Module({
  providers: [
    { provide: 'MAIL_TRANSPORTER', useFactory: () => nodemailer.createTransport({ host, port, auth }) },
  ],
})
export class EmailsModule {}

@Injectable()
export class EmailService {
  private readonly transporter = nodemailer.createTransport({ host, port, auth });
}
```

Each mail records the recipients (`to`, `cc`, `bcc`, `replyTo`), `from` (including the
transporter's defaults), the subject, the HTML (the dashboard renders it in a sandboxed frame; up to
50 KB) and the text, a preview of what the reader sees, attachment names and sizes (never their
content), whether it was sent or failed and why, how long it took, and the message id. A mail sent
while handling a request carries that request's batch ID. The send itself is untouched: same
arguments, same result, same error.

A sender the module cannot see (a transporter created inside a method, or an HTTP API client such
as Resend's or SES's) can be wired by hand through the injectable `TelemetryMailWatcher`:

```typescript
constructor(private readonly mailWatcher: TelemetryMailWatcher) {}

// nodemailer-style sendMail(options, callback?): record everything it sends from now on
this.mailWatcher.instrument(transporter);

// anything else: record the outcome yourself
await this.mailWatcher.record({ to, from, subject, html, status: 'failed', error: err.message });
```

Mail bodies have no field names to mask by, so they are masked by what can be recognised: every
JWT by its shape, and the query string and fragment of every link like a request's query string
(`https://app/reset?token=...` keeps the address and loses the token). A code written in the text
itself ("your code is 123456") is not masked. `watchers: { mail: false }` turns all of this off.

## REST API

All endpoints are under `{basePath}/api` (default: `/telemetry/api`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/entries` | List entries (query: type, page, size, userIdentifier, tenantId, method, statusGroup, search) |
| GET | `/entries/:uuid` | Get single entry |
| GET | `/entries/:uuid/related` | Get batch-related entries |
| GET | `/filters` | Filter dropdown data |
| GET | `/stats` | Entry count by type |
| GET | `/status` | Recording status + stats + memory |
| GET | `/tags` | Distinct tags |
| GET | `/memory` | Storage/buffer info |
| POST | `/toggle` | Toggle recording on/off |
| POST | `/flush` | Flush buffer to storage |
| POST | `/prune?hours=N` | Prune entries older than N hours |
| DELETE | `/entries?type=TYPE` | Clear entries |

## How It Works

Each watcher hooks into NestJS lifecycle mechanisms:

- **Requests**: `NestInterceptor` captures HTTP method, URL, status, duration, headers, body
- **Exceptions**: `ExceptionFilter` records error class, message, stack trace, request context
- **Logs**: `LoggerService` implementation captures all log levels with context filtering
- **Schedules**: Wrapper around `@Cron`/`@Interval`/`@Timeout` tasks recording duration and status
- **Cache**: `NestInterceptor` tracks cache HIT/MISS based on response timing
- **Events**: Records event name, payload, handler class/method
- **Mail**: Finds the nodemailer transporters and `@nestjs-modules/mailer`'s `MailerService` among your providers and records every `sendMail()`, sent or failed (see [Mail](#mail))
- **Queries** (TypeORM): `EntitySubscriberInterface` captures SQL with type classification
- **Queries** (Prisma): Middleware captures model, action, duration
- **Models** (TypeORM/Prisma): Tracks entity CREATED/UPDATED/DELETED changes

All entries within a single HTTP request share a `batchId` via `AsyncLocalStorage`, enabling the "related entries" view in the dashboard.

## Tech Stack

- **TypeScript**, **NestJS 10+**, **Node.js 18+**
- **better-sqlite3** for persistent storage
- **Alpine.js 3 + Tailwind CSS** for the dashboard UI
- **npm workspaces** monorepo

## Development

```bash
# Install dependencies
npm install

# Run all tests
npm test --workspaces

# Build all packages
npm run build --workspaces

# Run core tests only
cd packages/core && npm test
```

## License

MIT
