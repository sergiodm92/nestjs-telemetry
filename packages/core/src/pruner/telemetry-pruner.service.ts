import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';

@Injectable()
export class TelemetryPrunerService implements OnModuleDestroy {
  private readonly logger = new Logger(TelemetryPrunerService.name);
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly storage: TelemetryStorage,
    private readonly pruneHours: number,
    private readonly pruneIntervalMs: number,
    private readonly flushIntervalMs: number,
  ) {
    this.startPruning();
    this.startFlushing();
  }

  private startPruning(): void {
    this.pruneTimer = setInterval(async () => {
      try {
        const cutoff = new Date(Date.now() - this.pruneHours * 60 * 60 * 1000);
        const pruned = await this.storage.pruneOlderThan(cutoff);
        if (pruned > 0) {
          this.logger.debug(`Pruned ${pruned} telemetry entries`);
        }
      } catch (err) {
        this.logger.error('Failed to prune telemetry entries', err);
      }
    }, this.pruneIntervalMs);
  }

  private startFlushing(): void {
    this.flushTimer = setInterval(async () => {
      try {
        await this.storage.flush();
      } catch (err) {
        this.logger.error('Failed to flush telemetry buffer', err);
      }
    }, this.flushIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.storage.flush();
  }
}
