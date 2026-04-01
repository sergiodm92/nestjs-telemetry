import { TelemetryExceptionFilter } from '../src/watchers/exception.filter';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { HttpException, HttpStatus } from '@nestjs/common';

function mockHost(path = '/api/test', method = 'GET') {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return {
    switchToHttp: () => ({
      getRequest: () => ({ path, method, url: path }),
      getResponse: () => res,
    }),
    getType: () => 'http',
  } as any;
}

describe('TelemetryExceptionFilter', () => {
  let storage: InMemoryTelemetryStorage;
  let filter: TelemetryExceptionFilter;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    filter = new TelemetryExceptionFilter(storage);
  });

  it('records exception with class name, message, and stack trace', () => {
    const error = new Error('Something failed');
    const host = mockHost();

    expect(() => filter.catch(error, host)).toThrow('Something failed');

    return storage
      .getByType(TelemetryEntryType.EXCEPTION, {}, 0, 10)
      .then((entries) => {
        expect(entries).toHaveLength(1);
        expect(entries[0].content.class).toBe('Error');
        expect(entries[0].content.message).toBe('Something failed');
        expect(entries[0].content.trace).toBeDefined();
        expect(entries[0].content.uri).toBe('/api/test');
        expect(entries[0].content.method).toBe('GET');
      });
  });

  it('records HttpException with correct status', () => {
    const error = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    const host = mockHost();

    expect(() => filter.catch(error, host)).toThrow();

    return storage
      .getByType(TelemetryEntryType.EXCEPTION, {}, 0, 10)
      .then((entries) => {
        expect(entries[0].content.class).toBe('HttpException');
      });
  });

  it('truncates long stack traces', () => {
    const error = new Error('fail');
    error.stack = 'x'.repeat(10000);
    const host = mockHost();

    expect(() => filter.catch(error, host)).toThrow();

    return storage
      .getByType(TelemetryEntryType.EXCEPTION, {}, 0, 10)
      .then((entries) => {
        expect(entries[0].content.trace.length).toBeLessThanOrEqual(5050);
      });
  });

  it('re-throws the original exception', () => {
    const error = new Error('rethrow me');
    expect(() => filter.catch(error, mockHost())).toThrow('rethrow me');
  });
});
