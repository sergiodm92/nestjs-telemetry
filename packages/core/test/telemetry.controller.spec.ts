import { TelemetryController } from '../src/controller/telemetry.controller';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';

describe('TelemetryController', () => {
  let storage: InMemoryTelemetryStorage;
  let controller: TelemetryController;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    controller = new TelemetryController(storage);
  });

  it('GET /stats returns counts per type', async () => {
    await storage.store({
      uuid: 'u1',
      type: TelemetryEntryType.REQUEST,
      createdAt: new Date(),
      batchId: '',
      content: {},
      userIdentifier: '',
      tenantId: '',
      tags: [],
    });

    const result = await controller.getStats();
    expect(result.success).toBe(true);
    expect(result.data['REQUEST']).toBe(1);
  });

  it('GET /entries returns entries by type', async () => {
    await storage.store({
      uuid: 'u2',
      type: TelemetryEntryType.LOG,
      createdAt: new Date(),
      batchId: '',
      content: { level: 'INFO', message: 'test' },
      userIdentifier: '',
      tenantId: '',
      tags: [],
    });

    const result = await controller.getEntries('LOG', 0, 50, '', '', '', '', '');
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('POST /toggle toggles recording', async () => {
    expect(storage.isEnabled()).toBe(true);
    const result = await controller.toggle();
    expect(result.data.enabled).toBe(false);
  });

  it('DELETE /entries clears entries by type', async () => {
    await storage.store({
      uuid: 'u3',
      type: TelemetryEntryType.REQUEST,
      createdAt: new Date(),
      batchId: '',
      content: {},
      userIdentifier: '',
      tenantId: '',
      tags: [],
    });

    await controller.clearEntries('REQUEST');
    const stats = await storage.getStats();
    expect(stats['REQUEST']).toBe(0);
  });
});
