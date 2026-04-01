import { TelemetryEntryType } from './telemetry-entry-type';

export interface TelemetryEntry {
  uuid: string;
  type: TelemetryEntryType;
  createdAt: Date;
  batchId: string;
  content: Record<string, any>;
  userIdentifier: string;
  tenantId: string;
  tags: string[];
}
