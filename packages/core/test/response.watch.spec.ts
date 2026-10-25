import * as http from 'http';
import { AddressInfo } from 'net';
import { watchResponseBody } from '../src/watchers/request.interceptor';

/**
 * `watchResponseBody` on a real `http.ServerResponse`, to pin that it only observes: every way of
 * calling `write` and `end` must reach the client exactly as written, whatever is recorded.
 */

interface Exchange {
  client: Buffer;
  recorded: string;
}

function exchange(
  handler: (res: http.ServerResponse) => void,
  method = 'GET',
): Promise<Exchange> {
  return new Promise((resolve, reject) => {
    let recorded = '<never finished>';
    const server = http.createServer((req, res) => {
      const read = watchResponseBody(res);
      res.once('finish', () => {
        recorded = read ? read(true) : '<unwatched>';
      });
      handler(res);
    });
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ port, method }, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (part: Buffer) => parts.push(part));
        res.on('end', () => {
          server.close();
          resolve({ client: Buffer.concat(parts), recorded });
        });
      });
      req.on('error', reject);
      req.end();
    });
  });
}

describe('watchResponseBody on a real response', () => {
  it('hands encodings, callbacks and return values on untouched', async () => {
    const calls = { write: 0, end: 0 };
    let returned: unknown;

    const { client, recorded } = await exchange((res) => {
      res.setHeader('content-type', 'text/plain');
      returned = res.write('héllo ', 'utf8', () => {
        calls.write++;
      });
      res.end('wörld', 'utf8', () => {
        calls.end++;
      });
    });

    expect(client.toString('utf8')).toBe('héllo wörld');
    expect(recorded).toBe('héllo wörld');
    expect(typeof returned).toBe('boolean');
    expect(calls).toEqual({ write: 1, end: 1 });
  });

  it('decodes a multibyte character split across two chunks', async () => {
    const euro = Buffer.from('€');

    const { client, recorded } = await exchange((res) => {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.write(euro.subarray(0, 1));
      res.end(euro.subarray(1));
    });

    expect(client.toString('utf8')).toBe('€');
    expect(recorded).toBe('€');
  });

  it('records what was sent, not the chunk of a second end() that Node refuses', async () => {
    let secondEnd: unknown;

    const { client, recorded } = await exchange((res) => {
      res.setHeader('content-type', 'text/plain');
      // Node reports the refusal as an 'error' event on the response.
      res.on('error', (err) => {
        secondEnd = err;
      });
      res.end('first');
      res.end('second');
    });

    expect(client.toString()).toBe('first');
    expect(recorded).toBe('first');
    // Node's own refusal still happens: the wrapper does not swallow it.
    expect(String(secondEnd)).toMatch(/write after end/i);
  });

  it('records nothing for a HEAD request, whose body Node drops', async () => {
    const { recorded } = await exchange((res) => {
      res.setHeader('content-type', 'text/plain');
      res.end('body-that-is-never-sent');
    }, 'HEAD');

    expect(recorded).toBe('');
  });

  it('records nothing for a 204', async () => {
    const { recorded } = await exchange((res) => {
      res.statusCode = 204;
      res.setHeader('content-type', 'text/plain');
      res.end('body-that-is-never-sent');
    });

    expect(recorded).toBe('');
  });

  it.each([
    ['gzip', { 'content-type': 'application/json', 'content-encoding': 'gzip' }],
    ['an event stream', { 'content-type': 'text/event-stream' }],
    ['UTF-16 text', { 'content-type': 'application/json; charset=utf-16le' }],
    ['an image', { 'content-type': 'image/png' }],
  ])('does not buffer %s, and still sends it', async (_label, headers) => {
    const { client, recorded } = await exchange((res) => {
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
      res.end('{"password":"PW-SECRET"}');
    });

    expect(client.toString()).toBe('{"password":"PW-SECRET"}');
    expect(recorded).toBe('[non-text response omitted]');
  });

  it('counts the cap across several chunks, and still sends them all', async () => {
    const piece = 'x'.repeat(200 * 1024);

    const { client, recorded } = await exchange((res) => {
      res.setHeader('content-type', 'text/plain');
      res.write(piece);
      res.end(piece);
    });

    expect(client.length).toBe(2 * piece.length);
    expect(recorded).toBe('[response larger than 256 KB, not recorded]');
  });

  it('reads JSON when the headers were handed to writeHead, and ignores anything else then', async () => {
    const json = await exchange((res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"token":"T","a":1}');
    });
    const text = await exchange((res) => {
      res.writeHead(200, { 'x-other': '1' });
      res.end('password=hunter2');
    });

    expect(json.recorded).toBe('{"token":"***","a":1}');
    expect(text.recorded).toBe('[non-text response omitted]');
  });
});

describe('watchResponseBody on stand-ins for other servers', () => {
  function standIn(overrides: Record<string, unknown> = {}) {
    const sent: unknown[] = [];
    const res: any = {
      writableEnded: false,
      statusCode: 200,
      getHeader: (name: string) => (name === 'content-type' ? 'text/plain' : undefined),
      write(chunk: unknown) {
        sent.push(chunk);
        return true;
      },
      end(chunk?: unknown) {
        if (chunk !== undefined) sent.push(chunk);
        this.writableEnded = true;
      },
      ...overrides,
    };
    return { res, sent };
  }

  it('does not record twice when end() is built on write(), as HTTP/2 compat responses do', () => {
    const { res, sent } = standIn({
      end(this: any, chunk?: unknown) {
        this.write(chunk);
        this.writableEnded = true;
      },
    });
    const read = watchResponseBody(res)!;

    res.end('{"a":1}');

    expect(sent).toEqual(['{"a":1}']);
    expect(read(true)).toBe('{"a":1}');
  });

  it('marks a body whose connection closed before the response finished', () => {
    const { res } = standIn();
    const read = watchResponseBody(res)!;

    res.write('partial');

    expect(read(false)).toBe('partial [response incomplete: the connection closed first]');
  });

  it('lets an error thrown by the original reach the caller unchanged', () => {
    const boom = new Error('socket gone');
    const { res } = standIn({
      end() {
        throw boom;
      },
    });
    watchResponseBody(res);

    expect(() => res.end('x')).toThrow(boom);
  });

  it('survives an invalid encoding without breaking the response', () => {
    const { res, sent } = standIn();
    const read = watchResponseBody(res)!;

    res.write('abc', 'not-an-encoding');

    expect(sent).toEqual(['abc']);
    expect(read(true)).toBe('[non-text response omitted]');
  });

  it('leaves a response that refuses the wrapper as it was, and reports the failure', () => {
    const { res } = standIn();
    Object.defineProperty(res, 'end', { value: res.end, writable: false, configurable: false });
    const write = res.write;

    expect(() => watchResponseBody(res)).toThrow();
    expect(res.write).toBe(write);
  });

  it('answers undefined for a response that cannot be written to', () => {
    expect(watchResponseBody({})).toBeUndefined();
  });
});
