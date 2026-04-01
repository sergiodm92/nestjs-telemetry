import { TelemetryQuerySubscriber } from '../src/query.subscriber';
import { TelemetryEntryType } from '@nestjs-telemetry/core';

function createMockStorage() {
  const entries: any[] = [];
  return {
    store: jest.fn(async (entry: any) => entries.push(entry)),
    isEnabled: jest.fn(() => true),
    getByType: jest.fn(async () => entries),
    entries,
  };
}

describe('TelemetryQuerySubscriber', () => {
  it('records SQL query after execution', () => {
    const storage = createMockStorage();
    const subscriber = new TelemetryQuerySubscriber(storage as any);

    subscriber.afterQuery({
      query: 'SELECT * FROM users WHERE id = ?',
      parameters: [1],
      executionTime: 15,
    } as any);

    expect(storage.store).toHaveBeenCalledTimes(1);
    const entry = storage.store.mock.calls[0][0];
    expect(entry.type).toBe(TelemetryEntryType.QUERY);
    expect(entry.content.sql).toBe('SELECT * FROM users WHERE id = ?');
    expect(entry.content.type).toBe('SELECT');
    expect(entry.content.duration).toBe(15);
  });

  it('classifies SQL statement types', () => {
    const storage = createMockStorage();
    const subscriber = new TelemetryQuerySubscriber(storage as any);

    const types = [
      { sql: 'INSERT INTO users VALUES (1)', expected: 'INSERT' },
      { sql: 'UPDATE users SET name = ?', expected: 'UPDATE' },
      { sql: 'DELETE FROM users WHERE id = 1', expected: 'DELETE' },
      { sql: 'CREATE TABLE test (id INT)', expected: 'DDL' },
    ];

    for (const { sql, expected } of types) {
      subscriber.afterQuery({ query: sql, parameters: [], executionTime: 1 } as any);
      const entry = storage.store.mock.calls[storage.store.mock.calls.length - 1][0];
      expect(entry.content.type).toBe(expected);
    }
  });

  it('skips telemetry internal queries', () => {
    const storage = createMockStorage();
    const subscriber = new TelemetryQuerySubscriber(storage as any);

    subscriber.afterQuery({
      query: 'SELECT * FROM telemetry_entries WHERE uuid = ?',
      parameters: [],
      executionTime: 1,
    } as any);

    expect(storage.store).not.toHaveBeenCalled();
  });
});
