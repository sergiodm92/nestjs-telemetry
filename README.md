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
- **Sensitive data masking**: Authorization, Cookie, Set-Cookie headers are automatically masked
- **Body truncation**: Request bodies capped at 10KB, stack traces at 5KB
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
- **Mail**: Records to, from, subject with body preview truncation
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
