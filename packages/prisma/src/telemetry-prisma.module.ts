import { Module } from '@nestjs/common';

@Module({})
export class TelemetryPrismaModule {
  /**
   * Usage: In your PrismaService, apply the middlewares:
   *
   * ```typescript
   * import { createTelemetryQueryMiddleware, createTelemetryModelMiddleware } from '@nestjs-telemetry/prisma';
   *
   * @Injectable()
   * class PrismaService extends PrismaClient implements OnModuleInit {
   *   constructor(@Inject(TELEMETRY_STORAGE) private storage: TelemetryStorage) {
   *     super();
   *     this.$use(createTelemetryQueryMiddleware(storage));
   *     this.$use(createTelemetryModelMiddleware(storage));
   *   }
   * }
   * ```
   */
}
