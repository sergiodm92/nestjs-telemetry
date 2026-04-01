import { DynamicModule, Module, Provider } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
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
import { TelemetryExceptionFilter } from './watchers/exception.filter';
import { TelemetryLogWatcher } from './watchers/log.watcher';
import { TelemetryScheduleWatcher } from './watchers/schedule.watcher';
import { TelemetryCacheInterceptor } from './watchers/cache.interceptor';
import { TelemetryEventWatcher } from './watchers/event.watcher';
import { TelemetryMailWatcher } from './watchers/mail.watcher';
import { TelemetrySecurityGuard } from './watchers/security.guard';
import { TelemetryPrunerService } from './pruner/telemetry-pruner.service';

@Module({})
export class TelemetryModule {
  static forRoot(options?: Partial<TelemetryModuleOptions>): DynamicModule {
    const mergedOptions: Required<TelemetryModuleOptions> = {
      ...DEFAULT_OPTIONS,
      ...options,
      watchers: { ...DEFAULT_OPTIONS.watchers, ...options?.watchers },
    };

    const storageProvider: Provider = {
      provide: TELEMETRY_STORAGE,
      useFactory: (): TelemetryStorage => {
        if (mergedOptions.storage === 'sqlite') {
          return new SqliteTelemetryStorage(mergedOptions.sqlitePath);
        }
        return new InMemoryTelemetryStorage(mergedOptions.maxEntries);
      },
    };

    const userProviderDef: Provider = {
      provide: TELEMETRY_USER_PROVIDER,
      useClass: DefaultTelemetryUserProvider,
    };

    const optionsProvider: Provider = {
      provide: TELEMETRY_OPTIONS,
      useValue: mergedOptions,
    };

    const providers: Provider[] = [
      optionsProvider,
      storageProvider,
      userProviderDef,
      {
        provide: TelemetryPrunerService,
        useFactory: (storage: TelemetryStorage) =>
          new TelemetryPrunerService(
            storage,
            mergedOptions.pruneHours,
            mergedOptions.pruneIntervalMs,
            mergedOptions.flushIntervalMs,
          ),
        inject: [TELEMETRY_STORAGE],
      },
    ];

    const watchers = mergedOptions.watchers;

    if (watchers.requests) {
      providers.push({
        provide: TelemetryRequestInterceptor,
        useFactory: (storage: TelemetryStorage, userProvider: TelemetryUserProvider) =>
          new TelemetryRequestInterceptor(
            storage,
            userProvider,
            mergedOptions.ignoredPrefixes,
            mergedOptions.basePath,
          ),
        inject: [TELEMETRY_STORAGE, TELEMETRY_USER_PROVIDER],
      });
    }

    if (watchers.exceptions) {
      providers.push({
        provide: TelemetryExceptionFilter,
        useFactory: (storage: TelemetryStorage) =>
          new TelemetryExceptionFilter(storage),
        inject: [TELEMETRY_STORAGE],
      });
    }

    if (watchers.logs) {
      providers.push({
        provide: TelemetryLogWatcher,
        useFactory: (storage: TelemetryStorage) =>
          new TelemetryLogWatcher(storage, mergedOptions.basePackage),
        inject: [TELEMETRY_STORAGE],
      });
    }

    if (watchers.schedules) {
      providers.push({
        provide: TelemetryScheduleWatcher,
        useFactory: (storage: TelemetryStorage) =>
          new TelemetryScheduleWatcher(storage),
        inject: [TELEMETRY_STORAGE],
      });
    }

    if (watchers.cache) {
      providers.push({
        provide: TelemetryCacheInterceptor,
        useFactory: (storage: TelemetryStorage) =>
          new TelemetryCacheInterceptor(storage),
        inject: [TELEMETRY_STORAGE],
      });
    }

    if (watchers.events) {
      providers.push({
        provide: TelemetryEventWatcher,
        useFactory: (storage: TelemetryStorage) =>
          new TelemetryEventWatcher(storage),
        inject: [TELEMETRY_STORAGE],
      });
    }

    if (watchers.mail) {
      providers.push({
        provide: TelemetryMailWatcher,
        useFactory: (storage: TelemetryStorage) =>
          new TelemetryMailWatcher(storage),
        inject: [TELEMETRY_STORAGE],
      });
    }

    if (mergedOptions.accessToken) {
      providers.push({
        provide: TelemetrySecurityGuard,
        useFactory: () =>
          new TelemetrySecurityGuard(
            mergedOptions.basePath,
            mergedOptions.accessToken,
          ),
      });
    }

    return {
      module: TelemetryModule,
      global: true,
      imports: [
        RouterModule.register([
          { path: mergedOptions.basePath, module: TelemetryModule },
        ]),
      ],
      controllers: [TelemetryController],
      providers,
      exports: [
        TELEMETRY_STORAGE,
        TELEMETRY_USER_PROVIDER,
        TelemetryEventWatcher,
        TelemetryMailWatcher,
        TelemetryScheduleWatcher,
      ],
    };
  }

  static forRootAsync(optionsFactory: {
    useFactory: (...args: any[]) => TelemetryModuleOptions | Promise<TelemetryModuleOptions>;
    inject?: any[];
    imports?: any[];
  }): DynamicModule {
    return {
      module: TelemetryModule,
      global: true,
      imports: optionsFactory.imports || [],
      controllers: [TelemetryController],
      providers: [
        {
          provide: TELEMETRY_OPTIONS,
          useFactory: async (...args: any[]) => {
            const options = await optionsFactory.useFactory(...args);
            return { ...DEFAULT_OPTIONS, ...options, watchers: { ...DEFAULT_OPTIONS.watchers, ...options?.watchers } };
          },
          inject: optionsFactory.inject || [],
        },
        {
          provide: TELEMETRY_STORAGE,
          useFactory: (opts: Required<TelemetryModuleOptions>): TelemetryStorage => {
            if (opts.storage === 'sqlite') {
              return new SqliteTelemetryStorage(opts.sqlitePath);
            }
            return new InMemoryTelemetryStorage(opts.maxEntries);
          },
          inject: [TELEMETRY_OPTIONS],
        },
        {
          provide: TELEMETRY_USER_PROVIDER,
          useClass: DefaultTelemetryUserProvider,
        },
      ],
      exports: [TELEMETRY_STORAGE, TELEMETRY_USER_PROVIDER],
    };
  }
}
