import { TelemetryEntry } from '../model/telemetry-entry';
import { TelemetryEntryType } from '../model/telemetry-entry-type';

export interface EntryFilters {
  userIdentifier?: string;
  tenantId?: string;
  method?: string;
  statusGroup?: string;
  search?: string;
}

export interface TelemetryStorage {
  store(entry: TelemetryEntry): Promise<void>;
  getByType(type: TelemetryEntryType, filters: EntryFilters, page: number, size: number): Promise<TelemetryEntry[]>;
  countByType(type: TelemetryEntryType, filters: EntryFilters): Promise<number>;
  getByUuid(uuid: string): Promise<TelemetryEntry | null>;
  getByBatchId(batchId: string): Promise<TelemetryEntry[]>;
  getStats(): Promise<Record<string, number>>;
  clear(): Promise<void>;
  clearByType(type: TelemetryEntryType): Promise<void>;
  pruneOlderThan(date: Date): Promise<number>;
  getDistinctTags(): Promise<string[]>;
  getDistinctUserIdentifiers(): Promise<string[]>;
  getDistinctTenantIds(): Promise<string[]>;
  getMemoryInfo(): Promise<Record<string, any>>;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  flush(): Promise<void>;
}
