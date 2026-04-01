# NestJS Telemetry - Project Context

## Overview
NestJS Telemetry is a zero-configuration, real-time debugging and observability dashboard for NestJS applications. It's a monorepo with 3 npm packages, ported from Spring Telemetry (Spring Boot equivalent).

## Tech Stack
- **TypeScript**, **NestJS 10+**, **Node.js 18+**
- **better-sqlite3** for persistent storage
- **Alpine.js 3 + Tailwind CSS** for the single-page dashboard UI
- **Jest + ts-jest** for testing
- **npm workspaces** monorepo

## Build & Test
```bash
npm install               # Install all dependencies
npm test --workspaces     # Run all tests (73 tests, 16 suites)
npm run build --workspaces # Build all packages

# Individual packages
cd packages/core && npm test
cd packages/typeorm && npx jest --no-cache
cd packages/prisma && npx jest --no-cache
```

## Project Structure
```
nestjs-telemetry/
├── package.json                          # npm workspaces root
├── tsconfig.base.json                    # Shared TS config
├── packages/
│   ├── core/                             # @nestjs-telemetry/core
│   │   ├── src/
│   │   │   ├── index.ts                  # Public API barrel export
│   │   │   ├── telemetry.module.ts       # TelemetryModule with forRoot/forRootAsync
│   │   │   ├── telemetry.options.ts      # TelemetryModuleOptions interface + defaults
│   │   │   ├── telemetry.constants.ts    # Injection tokens (TELEMETRY_STORAGE, etc.)
│   │   │   ├── model/
│   │   │   │   ├── telemetry-entry.ts    # TelemetryEntry interface
│   │   │   │   └── telemetry-entry-type.ts # TelemetryEntryType enum (9 types)
│   │   │   ├── context/
│   │   │   │   ├── telemetry-context.ts  # AsyncLocalStorage batch context
│   │   │   │   └── telemetry-user.provider.ts # User provider interface + default
│   │   │   ├── storage/
│   │   │   │   ├── telemetry-storage.interface.ts # TelemetryStorage interface
│   │   │   │   ├── in-memory.storage.ts  # InMemoryTelemetryStorage
│   │   │   │   └── sqlite.storage.ts     # SqliteTelemetryStorage (buffer+flush)
│   │   │   ├── controller/
│   │   │   │   └── telemetry.controller.ts # REST API (14 endpoints + dashboard)
│   │   │   ├── watchers/
│   │   │   │   ├── request.interceptor.ts  # HTTP request/response capture
│   │   │   │   ├── exception.filter.ts     # Global exception recording
│   │   │   │   ├── log.watcher.ts          # LoggerService wrapper
│   │   │   │   ├── schedule.watcher.ts     # @Cron/@Interval/@Timeout wrapper
│   │   │   │   ├── cache.interceptor.ts    # Cache HIT/MISS tracker
│   │   │   │   ├── event.watcher.ts        # Event listener recorder
│   │   │   │   ├── mail.watcher.ts         # Mail send recorder
│   │   │   │   └── security.guard.ts       # Access token guard
│   │   │   ├── pruner/
│   │   │   │   └── telemetry-pruner.service.ts # Scheduled cleanup + flush
│   │   │   └── dashboard/
│   │   │       └── index.html            # Alpine.js + Tailwind SPA (~1750 lines)
│   │   └── test/                         # 12 spec files (60 tests)
│   ├── typeorm/                          # @nestjs-telemetry/typeorm
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── telemetry-typeorm.module.ts
│   │   │   ├── query.subscriber.ts       # SQL query capture
│   │   │   └── model.subscriber.ts       # Entity change tracking
│   │   └── test/                         # 2 spec files (7 tests)
│   └── prisma/                           # @nestjs-telemetry/prisma
│       ├── src/
│       │   ├── index.ts
│       │   ├── telemetry-prisma.module.ts
│       │   ├── query.middleware.ts        # Prisma query capture
│       │   └── model.middleware.ts        # Prisma model change tracking
│       └── test/                         # 2 spec files (6 tests)
```

## Architecture Patterns

### Dynamic Module
- `TelemetryModule.forRoot(options?)` is the main entry point
- `TelemetryModule.forRootAsync({ useFactory, inject, imports })` for async config
- Module is registered as `global: true`
- Uses `RouterModule.register()` to mount controller at `basePath`
- Each watcher is conditionally registered based on `options.watchers.*`

### Storage Interface
- `TelemetryStorage` is the core interface: `store()`, `getByType()`, `getByUuid()`, `getByBatchId()`, `clear()`, `pruneOlderThan()`, `getStats()`, `flush()`
- `InMemoryTelemetryStorage`: Array per type, max entries enforcement
- `SqliteTelemetryStorage`: Buffer + periodic flush to SQLite, WAL mode, prepared statements

### Batch Correlation
- `TelemetryContext` (AsyncLocalStorage) assigns a batchId to each HTTP request
- All entries from the same request share the batch ID
- Dashboard "related entries" view uses this

### User Context
- `TelemetryUserProvider` interface with `DefaultTelemetryUserProvider` (reads `req.user`)
- Supports `email`, `username`, `id`, `sub` fields automatically

### Injection Tokens
- `TELEMETRY_STORAGE` — inject storage anywhere
- `TELEMETRY_USER_PROVIDER` — inject user provider
- `TELEMETRY_OPTIONS` — inject resolved options

## Key Files
- `packages/core/src/telemetry.module.ts` — Main module definition
- `packages/core/src/telemetry.options.ts` — All configuration properties and defaults
- `packages/core/src/storage/telemetry-storage.interface.ts` — Storage contract
- `packages/core/src/controller/telemetry.controller.ts` — All REST API endpoints
- `packages/core/src/dashboard/index.html` — Dashboard UI

## Configuration Properties (TelemetryModuleOptions)
| Property | Default | Description |
|----------|---------|-------------|
| storage | 'memory' | Storage backend ('memory' or 'sqlite') |
| sqlitePath | '.telemetry.db' | SQLite database file path |
| basePath | '/telemetry' | Dashboard and API base URL |
| maxEntries | 1000 | Max entries per type (in-memory only) |
| pruneHours | 24 | Auto-prune age |
| pruneIntervalMs | 3600000 | Prune check interval (1h) |
| accessToken | '' | Token to protect dashboard |
| ignoredPrefixes | ['/health', '/swagger', '/api-docs'] | Request paths to skip |
| basePackage | '' | Log context filter prefix |
| flushIntervalMs | 2000 | SQLite buffer flush interval |
| watchers.* | true | Individual watcher toggles |

## REST API Endpoints (under `{basePath}`)
- `GET /` — Dashboard HTML
- `GET /entries` — List entries (params: type, page, size, userIdentifier, tenantId, method, statusGroup, search)
- `GET /entries/:uuid` — Single entry
- `GET /entries/:uuid/related` — Batch-related entries
- `GET /filters` — Filter dropdown data
- `GET /stats` — Entry count by type
- `GET /status` — Recording status + stats + memory info
- `GET /tags` — Distinct tags
- `GET /memory` — Storage/buffer info
- `POST /toggle` — Toggle recording on/off
- `POST /flush` — Flush buffer to storage
- `POST /prune?hours=N` — Prune entries older than N hours
- `POST /prune/expired?hours=N` — Prune by retention
- `DELETE /entries?type=TYPE` — Clear entries

## Conventions
- All watchers are stateless, receive `TelemetryStorage` via constructor injection
- Entry content stored as `Record<string, any>` (serialized to JSON for SQLite)
- Sensitive headers (Authorization, Cookie) are masked with `***`
- Request body truncated to 10KB, stack traces to 5KB
- TypeORM/Prisma packages skip queries/entities containing "telemetry" to avoid recursive recording
- Storage implementations check `isEnabled()` before recording
- TelemetryEntryType enum: REQUEST, EXCEPTION, QUERY, LOG, SCHEDULE, CACHE, EVENT, MAIL, MODEL

## Testing
- **73 tests total** across 16 test suites
- Core: 60 tests in 12 suites (storage, context, watchers, controller, module)
- TypeORM: 7 tests in 2 suites (query subscriber, model subscriber)
- Prisma: 6 tests in 2 suites (query middleware, model middleware)
- TypeORM/Prisma tests use `moduleNameMapper` to resolve `@nestjs-telemetry/core` to local source
- SQLite tests use temp files and clean up after
