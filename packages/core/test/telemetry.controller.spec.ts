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
    expect(result.data.entries).toHaveLength(1);
    expect(result.data.total).toBe(1);
  });

  it('GET /entries reports every matching entry as total, not the length of the page', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.store({
        uuid: `page-${i}`,
        type: TelemetryEntryType.LOG,
        createdAt: new Date(2026, 0, 1, 0, 0, i),
        batchId: '',
        content: { level: i % 2 === 0 ? 'INFO' : 'ERROR', message: 'test' },
        userIdentifier: '',
        tenantId: '',
        tags: [],
      });
    }

    const secondPage = await controller.getEntries('LOG', 1, 2);
    expect(secondPage.data.entries.map((e: { uuid: string }) => e.uuid)).toEqual(['page-2', 'page-1']);
    expect(secondPage.data.total).toBe(5);

    const filtered = await controller.getEntries('LOG', 0, 2, undefined, undefined, undefined, undefined, 'error');
    expect(filtered.data.entries).toHaveLength(2);
    expect(filtered.data.total).toBe(2);
  });

  it('GET /entries asks for a type', async () => {
    const result = await controller.getEntries('');
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
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
