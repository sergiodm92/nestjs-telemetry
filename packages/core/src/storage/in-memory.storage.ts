import { TelemetryEntry } from '../model/telemetry-entry';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { EntryFilters, TelemetryStorage } from './telemetry-storage.interface';

export class InMemoryTelemetryStorage implements TelemetryStorage {
  private readonly store_: Map<TelemetryEntryType, TelemetryEntry[]>;
  private enabled_: boolean;
  private readonly maxEntriesPerType: number;

  constructor(maxEntriesPerType = 1000) {
    this.maxEntriesPerType = maxEntriesPerType;
    this.enabled_ = true;
    this.store_ = new Map();
    for (const type of Object.values(TelemetryEntryType)) {
      this.store_.set(type, []);
    }
  }

  async store(entry: TelemetryEntry): Promise<void> {
    if (!this.enabled_) return;
    const list = this.store_.get(entry.type)!;
    list.unshift(entry);
    if (list.length > this.maxEntriesPerType) {
      list.pop();
    }
  }

  private applyFilters(entries: TelemetryEntry[], filters: EntryFilters): TelemetryEntry[] {
    return entries.filter((e) => {
      if (filters.userIdentifier && e.userIdentifier !== filters.userIdentifier) return false;
      if (filters.tenantId && e.tenantId !== filters.tenantId) return false;
      if (filters.method) {
        const entryMethod = e.content?.method as string | undefined;
        if (!entryMethod || entryMethod.toUpperCase() !== filters.method.toUpperCase()) return false;
      }
      if (filters.statusGroup) {
        const status = e.content?.status as number | undefined;
        if (status === undefined) return false;
        const group = filters.statusGroup.toLowerCase();
        const hundreds = Math.floor(status / 100);
        if (group !== `${hundreds}xx`) return false;
      }
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const values = Object.values(e.content ?? {});
        const matched = values.some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(term));
        if (!matched) return false;
      }
      return true;
    });
  }

  async getByType(
    type: TelemetryEntryType,
    filters: EntryFilters,
    page: number,
    size: number,
  ): Promise<TelemetryEntry[]> {
    const list = this.store_.get(type) ?? [];
    const filtered = this.applyFilters(list, filters);
    const start = page * size;
    return filtered.slice(start, start + size);
  }

  async countByType(type: TelemetryEntryType, filters: EntryFilters): Promise<number> {
    const list = this.store_.get(type) ?? [];
    return this.applyFilters(list, filters).length;
  }

  async getByUuid(uuid: string): Promise<TelemetryEntry | null> {
    for (const list of this.store_.values()) {
      const found = list.find((e) => e.uuid === uuid);
      if (found) return found;
    }
    return null;
  }

  async getByBatchId(batchId: string): Promise<TelemetryEntry[]> {
    const results: TelemetryEntry[] = [];
    for (const list of this.store_.values()) {
      for (const entry of list) {
        if (entry.batchId === batchId) results.push(entry);
      }
    }
    return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    for (const [type, list] of this.store_.entries()) {
      stats[type] = list.length;
    }
    return stats;
  }

  async clear(): Promise<void> {
    for (const type of Object.values(TelemetryEntryType)) {
      this.store_.set(type, []);
    }
  }

  async clearByType(type: TelemetryEntryType): Promise<void> {
    this.store_.set(type, []);
  }

  async pruneOlderThan(date: Date): Promise<number> {
    let pruned = 0;
    for (const [type, list] of this.store_.entries()) {
      const before = list.length;
      const filtered = list.filter((e) => e.createdAt >= date);
      pruned += before - filtered.length;
      this.store_.set(type, filtered);
    }
    return pruned;
  }

  async getDistinctTags(): Promise<string[]> {
    const tagSet = new Set<string>();
    for (const list of this.store_.values()) {
      for (const entry of list) {
        for (const tag of entry.tags ?? []) {
          tagSet.add(tag);
        }
      }
    }
    return Array.from(tagSet).sort();
  }

  async getDistinctUserIdentifiers(): Promise<string[]> {
    const set = new Set<string>();
    for (const list of this.store_.values()) {
      for (const entry of list) {
        if (entry.userIdentifier) set.add(entry.userIdentifier);
      }
    }
    return Array.from(set).sort();
  }

  async getDistinctTenantIds(): Promise<string[]> {
    const set = new Set<string>();
    for (const list of this.store_.values()) {
      for (const entry of list) {
        if (entry.tenantId) set.add(entry.tenantId);
      }
    }
    return Array.from(set).sort();
  }

  async getMemoryInfo(): Promise<Record<string, any>> {
    let totalEntries = 0;
    for (const list of this.store_.values()) {
      totalEntries += list.length;
    }
    return {
      type: 'memory',
      totalEntries,
      maxEntriesPerType: this.maxEntriesPerType,
      enabled: this.enabled_,
    };
  }

  isEnabled(): boolean {
    return this.enabled_;
  }

  setEnabled(enabled: boolean): void {
    this.enabled_ = enabled;
  }

  async flush(): Promise<void> {
    // no-op for in-memory storage
  }
}
