import { TelemetryMailWatcher } from '../src/watchers/mail.watcher';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';

describe('TelemetryMailWatcher', () => {
  let storage: InMemoryTelemetryStorage;
  let watcher: TelemetryMailWatcher;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    watcher = new TelemetryMailWatcher(storage);
  });

  it('records sent mail with to, from, subject', async () => {
    await watcher.record({
      to: 'user@example.com',
      from: 'noreply@app.com',
      subject: 'Welcome!',
      body: 'Hello there',
      type: 'text',
    });

    const entries = await storage.getByType(TelemetryEntryType.MAIL, {}, 0, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].content.to).toBe('user@example.com');
    expect(entries[0].content.from).toBe('noreply@app.com');
    expect(entries[0].content.subject).toBe('Welcome!');
  });

  it('truncates long body preview', async () => {
    await watcher.record({
      to: 'a@b.com',
      from: 'c@d.com',
      subject: 'Test',
      body: 'x'.repeat(1000),
      type: 'text',
    });

    const entries = await storage.getByType(TelemetryEntryType.MAIL, {}, 0, 10);
    expect(entries[0].content.bodyPreview.length).toBeLessThanOrEqual(550);
  });

  it('tags with mail and recipient', async () => {
    await watcher.record({
      to: 'dev@test.com',
      from: 'noreply@test.com',
      subject: 'Hi',
      body: '',
      type: 'html',
    });

    const entries = await storage.getByType(TelemetryEntryType.MAIL, {}, 0, 10);
    expect(entries[0].tags).toContain('mail');
    expect(entries[0].tags).toContain('to:dev@test.com');
  });
});
