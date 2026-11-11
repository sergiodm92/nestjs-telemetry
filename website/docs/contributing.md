---
title: Contributing
description: How the monorepo is laid out, how to build and test it, the conventions the code follows, how to add a watcher, and how to work on this documentation site.
---

The project lives at [github.com/sergiodm92/nestjs-telemetry](https://github.com/sergiodm92/nestjs-telemetry). Issues and pull requests are welcome.

## Layout

```text
nestjs-telemetry/
├── package.json            npm workspaces root (packages/*)
├── tsconfig.base.json      shared compiler options (ES2022, CommonJS, strict, decorators)
├── packages/
│   ├── core/               @nestjs-telemetry/core
│   │   ├── src/
│   │   │   ├── telemetry.module.ts      forRoot / forRootAsync, bindings
│   │   │   ├── telemetry.options.ts     options and defaults
│   │   │   ├── controller/              REST API
│   │   │   ├── storage/                 interface, in-memory, SQLite
│   │   │   ├── context/                 AsyncLocalStorage context, user provider
│   │   │   ├── watchers/                every watcher, the guard, mail instrumentation
│   │   │   ├── pruner/                  prune and flush timers
│   │   │   └── dashboard/index.html     the dashboard (Alpine.js + Tailwind)
│   │   └── test/                        unit and HTTP-level specs, test/support harness
│   ├── typeorm/            @nestjs-telemetry/typeorm (subscribers + module)
│   └── prisma/             @nestjs-telemetry/prisma (middlewares)
└── website/                this documentation (Docusaurus), not an npm workspace
```

## Set up, test, build

Node.js 20 or later is needed to develop (the test suite uses nodemailer 10).

```bash
npm install                    # every workspace
npm test --workspaces          # all test suites
npm run build --workspaces     # tsc, plus copying the dashboard HTML into core/dist
npm run lint --workspaces      # tsc --noEmit
```

Per package:

```bash
cd packages/core && npm test
cd packages/typeorm && npx jest
cd packages/prisma && npx jest
```

The TypeORM and Prisma packages resolve `@nestjs-telemetry/core` to `packages/core/src` through Jest's `moduleNameMapper`, so they test against the current core source.

## Conventions

- **Telemetry observes, it never acts.** A watcher must not change arguments, results, errors or responses, and must not throw into the host. Catch failures where recording happens.
- **Check `storage.isEnabled()`** before doing any recording work.
- **Mask by name, then by shape.** New data paths go through the masking helpers in `watchers/request.interceptor.ts`. When in doubt, mask.
- **Bound everything.** Truncate stored text, cap lists, and keep scans of untrusted input linear: no regular expression that can backtrack over a long input.
- **Test behavior, against a real app.** HTTP-level specs use `test/support/test-app.ts`, which builds a real Nest application with supertest. Prefer asserting on what the dashboard API returns over internal state.
- **The dashboard's API contract is pinned** by `test/dashboard.contract.spec.ts`: every API call the page makes must exist on the controller.

## Adding a watcher

1. Add or reuse a `TelemetryEntryType` and decide the entry's `content` fields and `tags`.
2. Write the watcher in `packages/core/src/watchers/`: it takes the storage, reads the batch from `TelemetryContext`, checks `isEnabled()`, and never throws into the host.
3. Wire it in `buildWatcherProviders()` in `telemetry.module.ts`, honoring its `watchers.*` switch, and export it from `src/index.ts` if users call it.
4. In `dashboard/index.html`: the list row, the detail panel, `getGroupKey()` and `getEntrySummary()`, using exactly the field names the watcher writes.
5. Specs: the watcher on its own, and through a real app.
6. Documentation: a page under `website/docs/watchers/` and the entry model.

## Releasing

Each package has a `prepublishOnly` script that builds it; `core`'s build copies `src/dashboard/index.html` into `dist/dashboard/`, which the controller serves. Each package ships `dist` and its own `LICENSE`. Bump the ORM packages' `@nestjs-telemetry/core` peer range when core's major or minor changes.

## This documentation

The site is a Docusaurus project in `website/`, outside the npm workspaces:

```bash
cd website
npm install
npm start          # dev server with live reload
npm run build      # static site in website/build; fails on broken links
npm run serve      # serve the build locally
```

Pages are plain Markdown in `website/docs/`, the sidebar is `website/sidebars.ts`. Write what the code does today, and state limitations plainly in a `:::warning[Current limitation]` block. The site is published at `https://sergiodm92.github.io/nestjs-telemetry/` by the `Docs` workflow (`.github/workflows/docs.yml`): on every push to `main` that changes `website/`, it builds the site and pushes `website/build` to the `gh-pages` branch, which GitHub Pages serves.
