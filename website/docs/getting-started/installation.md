---
title: Installation
description: Install @nestjs-telemetry/core and the optional ORM packages with npm, yarn or pnpm, understand the native SQLite dependency, and keep the dashboard out of production installs.
---

You need one package, `@nestjs-telemetry/core`. Add `@nestjs-telemetry/typeorm` or `@nestjs-telemetry/prisma` when you also want SQL queries and entity changes recorded. Check the [requirements](../intro.md#requirements) first: Node.js 18 or later, NestJS 10 or 11, and the Express adapter.

## Install the core package

```bash title="npm"
npm install @nestjs-telemetry/core
```

```bash title="yarn"
yarn add @nestjs-telemetry/core
```

```bash title="pnpm"
pnpm add @nestjs-telemetry/core
```

Then register the module in your root module: see [Quick start](./quick-start.md).

## Add an ORM package

Install the package that matches your ORM, next to the core package.

```bash title="TypeORM"
npm install @nestjs-telemetry/typeorm
yarn add @nestjs-telemetry/typeorm
pnpm add @nestjs-telemetry/typeorm
```

```bash title="Prisma"
npm install @nestjs-telemetry/prisma
yarn add @nestjs-telemetry/prisma
pnpm add @nestjs-telemetry/prisma
```

Run only the line for your package manager. Registering them is covered in [TypeORM](../integrations/typeorm.md) and [Prisma](../integrations/prisma.md).

## Peer dependencies

Peer dependencies are packages the telemetry packages use but expect your application to provide. A NestJS application already has everything the core package asks for.

| Package | Peer dependency | Accepted versions |
| --- | --- | --- |
| core | `@nestjs/common` | `^10.0.0` or `^11.0.0` |
| core | `@nestjs/core` | `^10.0.0` or `^11.0.0` |
| core | `reflect-metadata` | `^0.1.13` or `^0.2.0` |
| core | `rxjs` | `^7.0.0` |
| typeorm | `@nestjs-telemetry/core` | `^0.1.0` or `^0.2.0` |
| typeorm | `@nestjs/common`, `@nestjs/core` | `^10.0.0` or `^11.0.0` |
| typeorm | `@nestjs/typeorm` | `^10.0.0` or `^11.0.0` |
| typeorm | `typeorm` | `^0.3.0` or `^1.0.0` |
| prisma | `@nestjs-telemetry/core` | `^0.1.0` or `^0.2.0` |
| prisma | `@nestjs/common`, `@nestjs/core` | `^10.0.0` or `^11.0.0` |
| prisma | `@prisma/client` | `^5.0.0` or `^6.0.0` |

When one of your versions falls outside a range, npm 7 and later stops with an `ERESOLVE` error instead of installing.

The repository's tests run against NestJS 10, TypeORM 0.3 with `@nestjs/typeorm` 10, and Prisma Client 5. The other versions in these ranges are accepted but not tested there.

### Optional integrations

The core package.json also marks `@nestjs/schedule`, `@nestjs/cache-manager`, `@nestjs/event-emitter` and `@nestjs-modules/mailer` as optional peers in `peerDependenciesMeta`. No code in the package imports them, so you never install them for the sake of telemetry. The same goes for nodemailer: mail capture instruments the transporters your application already creates.

## The native SQLite dependency

The core package has two regular dependencies: `uuid` and `better-sqlite3` (`^11.0.0`), the driver behind the SQLite storage. Because `better-sqlite3` is a regular dependency, it is installed even when you keep the default in-memory storage.

`better-sqlite3` is a native addon. Its install script runs `prebuild-install || node-gyp rebuild --release`:

1. `prebuild-install` downloads a prebuilt binary for your operating system, CPU architecture and Node.js version from the GitHub releases of `better-sqlite3`.
2. If no binary matches, or the download is blocked, `node-gyp` compiles the addon from source. That needs Python 3, `make` and a C++ compiler: `build-essential` on Debian and Ubuntu, the Xcode Command Line Tools on macOS, or Visual Studio Build Tools with the C++ workload on Windows.

If both steps fail, the whole install fails, whichever storage you use.

At runtime the binary is loaded only when the SQLite storage is created, that is, with `storage: 'sqlite'`. The in-memory storage never loads it, so an application on the default storage starts even if the binary is missing or was built for another Node.js version.

### When the SQLite storage cannot load the binary

With `storage: 'sqlite'`, a missing or mismatched binary stops the application at startup. These are the usual causes:

- **pnpm skipped the build.** pnpm 10 and later do not run the install scripts of dependencies until you approve them. Run `pnpm approve-builds` and allow `better-sqlite3`, then reinstall. The error mentions `Could not locate the bindings file`.
- **Node.js changed after the install.** The binary is built for one Node.js version. Run `npm rebuild better-sqlite3` after switching versions. The error mentions `was compiled against a different Node.js version`.
- **The image changed.** In a Docker build, install dependencies in an image with the same operating system and C library as the one that runs the application. A binary built on a Debian-based image does not load on Alpine.

## TypeScript configuration

The packages ship CommonJS compiled for ES2022, with type declarations. They need nothing beyond what NestJS needs: `experimentalDecorators` and `emitDecoratorMetadata`, which the `tsconfig.json` generated by the Nest CLI already sets.

```json title="tsconfig.json"
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

`emitDecoratorMetadata` is what lets Nest inject a watcher by its class, as in `constructor(private readonly mailWatcher: TelemetryMailWatcher)`. Tokens such as `TELEMETRY_STORAGE` are injected with `@Inject()`. The public declarations reference only `@nestjs/common` and `rxjs`, so you need no extra `@types` package, with or without `skipLibCheck`.

## Development-only setup

A common setup keeps the dashboard in development and staging and out of production. Install the package as a development dependency:

```bash title="npm"
npm install --save-dev @nestjs-telemetry/core
```

```bash title="yarn"
yarn add --dev @nestjs-telemetry/core
```

```bash title="pnpm"
pnpm add --save-dev @nestjs-telemetry/core
```

A production install that omits development dependencies does not contain the package:

| Package manager | Production install |
| --- | --- |
| npm | `npm ci --omit=dev` |
| yarn (classic) | `yarn install --production` |
| pnpm | `pnpm install --prod` |

In that install, a static `import { TelemetryModule } from '@nestjs-telemetry/core'` makes the application crash at boot with `Cannot find module`. Load the package at runtime instead, and only outside production:

```ts title="src/telemetry.imports.ts"
import type { DynamicModule, Type } from '@nestjs/common';
// A type-only import is erased by the compiler: it never loads the package at runtime.
import type * as Telemetry from '@nestjs-telemetry/core';

export function telemetryImports(): Array<Type<unknown> | DynamicModule> {
  if (process.env.NODE_ENV === 'production') return [];

  let telemetry: typeof Telemetry;
  try {
    telemetry = require('@nestjs-telemetry/core');
  } catch (err) {
    // Not installed (a production install without devDependencies): run without it.
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return [];
    throw err;
  }

  return [telemetry.TelemetryModule.forRoot()];
}
```

```ts title="src/app.module.ts"
import { Module } from '@nestjs/common';
import { telemetryImports } from './telemetry.imports';

@Module({
  imports: [
    // ...your other modules
    ...telemetryImports(),
  ],
})
export class AppModule {}
```

How this behaves:

- **Two independent guards.** The `NODE_ENV` check keeps the module off in production even when the package happens to be installed; the `require()` check keeps a production install without it bootable. Nest does not set `NODE_ENV` for you, so use whatever variable your deployment sets.
- **Only a missing package is tolerated.** Any other error thrown while loading the package still stops the boot.
- **Value imports defeat it.** `import type` is erased at compile time, but a value import from the package anywhere in code that runs in production, such as `import { TELEMETRY_STORAGE } from '@nestjs-telemetry/core'` in a service, loads it again and crashes the same way.
- **Linting.** If your ESLint configuration forbids `require()` (typescript-eslint's `no-require-imports` rule), disable that rule on the `require()` line.

Pass options to `forRoot()` inside the helper as usual. To read them from `ConfigService`, return `TelemetryModule.forRootAsync(...)` from the helper instead: see [Async configuration](./async-configuration.md).

### ORM packages in a development-only setup

Install the ORM package as a development dependency too, and load it the same way:

- **TypeORM.** `TelemetryTypeOrmModule` is a plain module. Load `@nestjs-telemetry/typeorm` with `require()` in the same helper and add its `TelemetryTypeOrmModule` to the returned array, after `TelemetryModule.forRoot()`.
- **Prisma.** The middlewares are registered in your own `PrismaService`, which receives the storage through the `TELEMETRY_STORAGE` token. When the telemetry module is not loaded, that provider does not exist. Inject it with `@Optional() @Inject('TELEMETRY_STORAGE')`, where `'TELEMETRY_STORAGE'` is the value of the exported constant (importing the constant would load the package), register the middlewares only when the storage is defined, and load `@nestjs-telemetry/prisma` with `require()` inside that branch.
