import { Module } from '@nestjs/common';
import { TELEMETRY_STORAGE } from '@nestjs-telemetry/core';
import { TelemetryQuerySubscriber } from './query.subscriber';
import { TelemetryModelSubscriber } from './model.subscriber';

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
export class TelemetryTypeOrmModule {}
