import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TelemetryContext } from '../context/telemetry-context';

const MAX_BODY_PREVIEW = 500;

export interface MailInfo {
  to: string;
  from: string;
  subject: string;
  body: string;
  type: string;
}

@Injectable()
export class TelemetryMailWatcher {
  constructor(private readonly storage: TelemetryStorage) {}

  async record(mail: MailInfo): Promise<void> {
    if (!this.storage.isEnabled()) return;

    const bodyPreview =
      mail.body.length > MAX_BODY_PREVIEW
        ? mail.body.substring(0, MAX_BODY_PREVIEW) + '... [truncated]'
        : mail.body;

    await this.storage.store({
      uuid: uuidv4(),
      type: TelemetryEntryType.MAIL,
      createdAt: new Date(),
      batchId: TelemetryContext.getBatchId() || '',
      content: {
        to: mail.to,
        from: mail.from,
        subject: mail.subject,
        bodyPreview,
        type: mail.type,
      },
      userIdentifier: TelemetryContext.getUserIdentifier() || '',
      tenantId: TelemetryContext.getTenantId() || '',
      tags: ['mail', `to:${mail.to}`],
    });
  }
}
