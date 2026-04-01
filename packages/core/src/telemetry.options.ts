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
  maxEntries?: number;
  pruneHours?: number;
  pruneIntervalMs?: number;
  accessToken?: string;
  ignoredPrefixes?: string[];
  basePackage?: string;
  flushIntervalMs?: number;
  watchers?: TelemetryWatcherOptions;
}

export const DEFAULT_OPTIONS: Required<TelemetryModuleOptions> = {
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
