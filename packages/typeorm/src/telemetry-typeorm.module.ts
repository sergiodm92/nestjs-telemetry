import { Module, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TELEMETRY_STORAGE } from '@nestjs-telemetry/core';
import { TelemetryQuerySubscriber } from './query.subscriber';
import { TelemetryModelSubscriber } from './model.subscriber';

/**
 * Wires the TypeORM query + model watchers into the active DataSource.
 *
 * TypeORM only invokes subscribers it finds in `DataSource.subscribers`; a
 * subscriber created by the Nest DI container is invisible to the broadcaster
 * unless it is pushed onto that array. We register the DI instances (so they
 * receive the telemetry storage) and attach them in onModuleInit.
 */
@Module({
  providers: [
    {
      provide: TelemetryQuerySubscriber,
      useFactory: (storage: any) => new TelemetryQuerySubscriber(storage),
      inject: [TELEMETRY_STORAGE],
    },
    {
      provide: TelemetryModelSubscriber,
      useFactory: (storage: any) => new TelemetryModelSubscriber(storage),
      inject: [TELEMETRY_STORAGE],
    },
  ],
  exports: [TelemetryQuerySubscriber, TelemetryModelSubscriber],
})
export class TelemetryTypeOrmModule implements OnModuleInit {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly querySubscriber: TelemetryQuerySubscriber,
    private readonly modelSubscriber: TelemetryModelSubscriber,
  ) {}

  onModuleInit(): void {
    const subscribers = this.dataSource.subscribers;
    if (!subscribers.includes(this.querySubscriber)) {
      subscribers.push(this.querySubscriber);
    }
    if (!subscribers.includes(this.modelSubscriber)) {
      subscribers.push(this.modelSubscriber);
    }
  }
}
