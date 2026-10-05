export interface TelemetryWatcherOptions {
  requests?: boolean;
  exceptions?: boolean;
  queries?: boolean;
  logs?: boolean;
  schedules?: boolean;
  cache?: boolean;
  events?: boolean;
  mail?: boolean;
  models?: boolean;
}

export interface TelemetryModuleOptions {
  storage?: 'memory' | 'sqlite';
  sqlitePath?: string;
  basePath?: string;
  /**
   * The path incoming requests actually carry, if different from `basePath` — e.g. when the
   * consuming app applies a global prefix (`app.setGlobalPrefix(...)`) on top of the route this
   * module registers via `RouterModule`. `basePath` is used only for that registration, which
   * happens before any global prefix is applied; `externalBasePath` is what request-time checks
   * (the access-token guard, and the request watcher's self-exclusion) compare against instead.
   * Defaults to `basePath` when omitted, which is correct for the common case of no global prefix
   * — most existing consumers need no change.
   */
  externalBasePath?: string;
  maxEntries?: number;
  pruneHours?: number;
  pruneIntervalMs?: number;
  accessToken?: string;
  ignoredPrefixes?: string[];
  basePackage?: string;
  flushIntervalMs?: number;
  watchers?: TelemetryWatcherOptions;
}

// `externalBasePath` is deliberately excluded from this `Required<...>` type and from the
// object below: it has no standalone default — it falls back to `basePath` dynamically wherever
// options are consumed (see telemetry.module.ts), so baking a literal default in here would
// break that fallback for consumers who customize `basePath` but not this field.
export const DEFAULT_OPTIONS: Required<
  Omit<TelemetryModuleOptions, 'externalBasePath'>
> = {
  storage: 'memory',
  sqlitePath: '.telemetry.db',
  basePath: '/telemetry',
  maxEntries: 1000,
  pruneHours: 24,
  pruneIntervalMs: 3600000,
  accessToken: '',
  ignoredPrefixes: ['/health', '/swagger', '/api-docs'],
  basePackage: '',
  flushIntervalMs: 2000,
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
};
