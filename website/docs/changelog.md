---
title: Changelog
description: Notable changes to the NestJS Telemetry packages, newest first.
---

Versions: `@nestjs-telemetry/core` 0.2.3, `@nestjs-telemetry/typeorm` 0.2.0, `@nestjs-telemetry/prisma` 0.1.0.

## Unreleased

### Added

- **Automatic mail capture.** At startup the module finds nodemailer transporters (providers, or fields of providers and controllers) and `@nestjs-modules/mailer`'s `MailerService`, and records every message they send or fail to send: recipients, sender, subject, rendered HTML, text, attachments (names and sizes), status, error, duration, message id. `watchers.mail` now turns it off. See [Mail](./watchers/mail.md).
- `TelemetryMailWatcher.instrument()` for senders created after startup; `record()` accepts nodemailer's options as they are and never throws.
- The Mail view shows the status, error, every address and attachment, and renders the HTML in a sandboxed frame with remote content blocked until you ask for it.
- Mail bodies are masked: JWTs and the query string of every link.

### Fixed

- **The access token is asked on every route of the dashboard.** The guard compared the request path with `basePath`, so the dashboard and its API were served without the token for a case variant of the URL (`/Telemetry/api/entries`), under a global prefix without `externalBasePath`, with a `basePath` written without its leading slash (or the page with a trailing slash), when the two `basePath`s of `forRootAsync` differed, and on Fastify. It is now bound to the dashboard's controller and never looks at the path. Your routes that merely start with the same characters (`/telemetryx`) no longer answer `403`, and a GraphQL resolver no longer fails in the guard once a token is set.
- The access token is compared in constant time.
- The JWT masking expression could take seconds on a body of JWT-like text, blocking the event loop for any client; it is now linear.
- A query value carrying a URL with a sensitive parameter (`?next=https://app/reset?token=...`) is now masked.

### Changed

- `TelemetrySecurityGuard` is no longer a global guard, and is constructed with the module options (`{ accessToken }`) instead of `(basePath, accessToken)`. `externalBasePath` now only affects the request watcher.

## 2026-10-25

### Fixed

- The dashboard's JSON API is served under `{basePath}/api`, where the page calls it, so the dashboard shows data again.
- Credentials are masked in request bodies, query strings and headers, by name and JWT shape.
- The response body and headers are stored next to the request, masked like the request.
- An error `code` stays readable in recorded responses.

## 2026-10-05

### Fixed

- `externalBasePath` is honored by the access-token guard and the request watcher under a global prefix.

## 2026-10-04

### Changed

- Core and TypeORM packages prepared for a public npm release, each with its own `LICENSE`.

## 2026-06-03

### Fixed

- Watchers are bound automatically by the module, exceptions are captured without breaking the host's exception filters, and packaging was fixed.
- TypeORM subscribers are attached to the `DataSource`, so queries and entity changes are recorded.

### Changed

- The Prisma package accepts a wider range of peer dependencies and builds before publishing.

## 2026-04-01

### Added

- First implementation: `TelemetryModule` with `forRoot` and `forRootAsync`, request, exception, log, schedule, cache, event and mail watchers, in-memory and SQLite storage with pruning, `AsyncLocalStorage` batch correlation, the REST API and the dashboard, plus the TypeORM and Prisma packages.
