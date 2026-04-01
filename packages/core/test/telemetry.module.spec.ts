import { Test } from '@nestjs/testing';
import { TelemetryModule } from '../src/telemetry.module';
import { TELEMETRY_STORAGE } from '../src/telemetry.constants';
import { TelemetryController } from '../src/controller/telemetry.controller';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TelemetryModule', () => {
  it('creates module with default options', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelemetryModule.forRoot()],
    }).compile();

    const storage = moduleRef.get(TELEMETRY_STORAGE);
    expect(storage).toBeDefined();
    expect(storage.isEnabled()).toBe(true);

    await moduleRef.close();
  });

  it('creates module with sqlite storage', async () => {
    const dbPath = path.join(os.tmpdir(), `test-module-${Date.now()}.db`);

    const moduleRef = await Test.createTestingModule({
      imports: [
        TelemetryModule.forRoot({ storage: 'sqlite', sqlitePath: dbPath }),
      ],
    }).compile();

    const storage = moduleRef.get(TELEMETRY_STORAGE);
    const info = await storage.getMemoryInfo();
    expect(info.type).toBe('sqlite');

    await moduleRef.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('registers the controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelemetryModule.forRoot()],
    }).compile();

    const controller = moduleRef.get(TelemetryController);
    expect(controller).toBeDefined();

    await moduleRef.close();
  });
});
