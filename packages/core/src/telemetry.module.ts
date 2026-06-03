import {
  CanActivate,
  DynamicModule,
  Module,
  NestInterceptor,
  Provider,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, RouterModule } from '@nestjs/core';
import {
  TelemetryModuleOptions,
  DEFAULT_OPTIONS,
} from './telemetry.options';
import {
  TELEMETRY_OPTIONS,
  TELEMETRY_STORAGE,
  TELEMETRY_USER_PROVIDER,
} from './telemetry.constants';
import { InMemoryTelemetryStorage } from './storage/in-memory.storage';
import { SqliteTelemetryStorage } from './storage/sqlite.storage';
import { TelemetryStorage } from './storage/telemetry-storage.interface';
import {
  DefaultTelemetryUserProvider,
  TelemetryUserProvider,
} from './context/telemetry-user.provider';
import { TelemetryController } from './controller/telemetry.controller';
import { TelemetryRequestInterceptor } from './watchers/request.interceptor';
import { TelemetryExceptionInterceptor } from './watchers/exception.interceptor';
import { TelemetryLogWatcher } from './watchers/log.watcher';
import { TelemetryScheduleWatcher } from './watchers/schedule.watcher';
import { TelemetryCacheInterceptor } from './watchers/cache.interceptor';
import { TelemetryEventWatcher } from './watchers/event.watcher';
import { TelemetryMailWatcher } from './watchers/mail.watcher';
import { TelemetrySecurityGuard } from './watchers/security.guard';
import { TelemetryPrunerService } from './pruner/telemetry-pruner.service';

type ResolvedOptions = Required<TelemetryModuleOptions>;

/** No-op binding used when a watcher toggle is disabled. */
const PASS_THROUGH_INTERCEPTOR: NestInterceptor = {
  intercept: (_context, next) => next.handle(),
};
const PASS_THROUGH_GUARD: CanActivate = { canActivate: () => true };

/** Providers shared by forRoot and forRootAsync so the two cannot drift. */
const SHARED_EXPORTS = [
  TELEMETRY_STORAGE,
  TELEMETRY_USER_PROVIDER,
  TelemetryLogWatcher,
  TelemetryScheduleWatcher,
  TelemetryEventWatcher,
  TelemetryMailWatcher,
];

const storageProvider: Provider = {
  provide: TELEMETRY_STORAGE,
  useFactory: (opts: ResolvedOptions): TelemetryStorage =>
    opts.storage === 'sqlite'
      ? new SqliteTelemetryStorage(opts.sqlitePath)
      : new InMemoryTelemetryStorage(opts.maxEntries),
  inject: [TELEMETRY_OPTIONS],
};

const userProviderDef: Provider = {
  provide: TELEMETRY_USER_PROVIDER,
  useClass: DefaultTelemetryUserProvider,
};

/**
 * Watcher providers + global bindings, gated at runtime on the RESOLVED
 * options. Reading TELEMETRY_OPTIONS inside each factory (instead of a closed
 * over `mergedOptions`) is what makes forRootAsync behave identically to
 * forRoot even though its options resolve asynchronously.
 */
function buildWatcherProviders(): Provider[] {
  return [
    {
      provide: TelemetryPrunerService,
      useFactory: (opts: ResolvedOptions, storage: TelemetryStorage) =>
        new TelemetryPrunerService(
          storage,
          opts.pruneHours,
          opts.pruneIntervalMs,
          opts.flushIntervalMs,
        ),
      inject: [TELEMETRY_OPTIONS, TELEMETRY_STORAGE],
    },
    // Passive helpers — instrumented manually by the consumer (app.useLogger /
    // .record() / .wrap()), so they are exposed as injectables, never bound.
    {
      provide: TelemetryLogWatcher,
      useFactory: (opts: ResolvedOptions, storage: TelemetryStorage) =>
        new TelemetryLogWatcher(storage, opts.basePackage),
      inject: [TELEMETRY_OPTIONS, TELEMETRY_STORAGE],
    },
    {
      provide: TelemetryScheduleWatcher,
      useFactory: (storage: TelemetryStorage) =>
        new TelemetryScheduleWatcher(storage),
      inject: [TELEMETRY_STORAGE],
    },
    {
      provide: TelemetryEventWatcher,
      useFactory: (storage: TelemetryStorage) =>
        new TelemetryEventWatcher(storage),
      inject: [TELEMETRY_STORAGE],
    },
    {
      provide: TelemetryMailWatcher,
      useFactory: (storage: TelemetryStorage) =>
        new TelemetryMailWatcher(storage),
      inject: [TELEMETRY_STORAGE],
    },
    // Global bindings. Registration order = execution order: the request
    // interceptor is outermost so it establishes the TelemetryContext (batchId)
    // that the inner exception/cache interceptors read.
    {
      provide: APP_INTERCEPTOR,
      useFactory: (
        opts: ResolvedOptions,
        storage: TelemetryStorage,
        userProvider: TelemetryUserProvider,
      ): NestInterceptor =>
        opts.watchers.requests
          ? new TelemetryRequestInterceptor(
              storage,
              userProvider,
              opts.ignoredPrefixes,
              opts.basePath,
            )
          : PASS_THROUGH_INTERCEPTOR,
      inject: [TELEMETRY_OPTIONS, TELEMETRY_STORAGE, TELEMETRY_USER_PROVIDER],
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (
        opts: ResolvedOptions,
        storage: TelemetryStorage,
      ): NestInterceptor =>
        opts.watchers.exceptions
          ? new TelemetryExceptionInterceptor(storage)
          : PASS_THROUGH_INTERCEPTOR,
      inject: [TELEMETRY_OPTIONS, TELEMETRY_STORAGE],
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (
        opts: ResolvedOptions,
        storage: TelemetryStorage,
      ): NestInterceptor =>
        opts.watchers.cache
          ? new TelemetryCacheInterceptor(storage)
          : PASS_THROUGH_INTERCEPTOR,
      inject: [TELEMETRY_OPTIONS, TELEMETRY_STORAGE],
    },
    {
      provide: APP_GUARD,
      useFactory: (opts: ResolvedOptions): CanActivate =>
        opts.accessToken
          ? new TelemetrySecurityGuard(opts.basePath, opts.accessToken)
          : PASS_THROUGH_GUARD,
      inject: [TELEMETRY_OPTIONS],
    },
  ];
}

@Module({})
export class TelemetryModule {
  static forRoot(options?: Partial<TelemetryModuleOptions>): DynamicModule {
    const mergedOptions: ResolvedOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
      watchers: { ...DEFAULT_OPTIONS.watchers, ...options?.watchers },
    };

    return {
      module: TelemetryModule,
      global: true,
      imports: [
        RouterModule.register([
          { path: mergedOptions.basePath, module: TelemetryModule },
        ]),
      ],
      controllers: [TelemetryController],
      providers: [
        { provide: TELEMETRY_OPTIONS, useValue: mergedOptions },
        storageProvider,
        userProviderDef,
        ...buildWatcherProviders(),
      ],
      exports: SHARED_EXPORTS,
    };
  }

  static forRootAsync(optionsFactory: {
    useFactory: (
      ...args: any[]
    ) => TelemetryModuleOptions | Promise<TelemetryModuleOptions>;
    inject?: any[];
    imports?: any[];
    /**
     * Dashboard/API mount path. Must be set here (synchronously) because the
     * route is registered at module-definition time, before the async factory
     * runs. Keep it in sync with the `basePath` your useFactory returns.
     */
    basePath?: string;
  }): DynamicModule {
    return {
      module: TelemetryModule,
      global: true,
      imports: [
        ...(optionsFactory.imports || []),
        RouterModule.register([
          {
            path: optionsFactory.basePath || DEFAULT_OPTIONS.basePath,
            module: TelemetryModule,
          },
        ]),
      ],
      controllers: [TelemetryController],
      providers: [
        {
          provide: TELEMETRY_OPTIONS,
          useFactory: async (...args: any[]): Promise<ResolvedOptions> => {
            const options = await optionsFactory.useFactory(...args);
            return {
              ...DEFAULT_OPTIONS,
              ...options,
              watchers: {
                ...DEFAULT_OPTIONS.watchers,
                ...options?.watchers,
              },
            };
          },
          inject: optionsFactory.inject || [],
        },
        storageProvider,
        userProviderDef,
        ...buildWatcherProviders(),
      ],
      exports: SHARED_EXPORTS,
    };
  }
}
