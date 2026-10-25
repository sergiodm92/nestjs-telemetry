import request from 'supertest';
import { SAMPLE_JWT, TestApp, createTestApp, waitForRequests } from './support/test-app';

/**
 * What the dashboard shows of a response, through a real app: the entry holds what the client was
 * sent (masked), and the client is still sent exactly what the handler produced.
 */
describe.each([
  ['Nest default exception handling', false],
  ['a host exception filter writing the responses', true],
])('response capture with %s', (_label, hostFilter) => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp({ hostFilter });
  });

  afterEach(() => app.close());

  async function fetchAndRecord(url: string) {
    const res = await request(app.server).get(url);
    const [entry] = await waitForRequests(app.storage, 1);
    return { res, content: entry.content };
  }

  it('stores a JSON response with its tokens masked, and still sends the client the real one', async () => {
    const { res, content } = await fetchAndRecord('/demo/login-result');

    expect(res.body.accessToken).toBe('AT-SECRET');
    expect(JSON.parse(content.responseBody)).toEqual({
      user: 'ana',
      accessToken: '***',
      refresh_token: '***',
      profile: { name: 'Ana' },
    });
    expect(content.responseContentType).toContain('application/json');
    expect(content.responseHeaders['content-type']).toContain('application/json');
  });

  it('keeps an error `code` readable in a response, where it is a status code, and masks the rest', async () => {
    const { content } = await fetchAndRecord('/demo/coded');

    expect(JSON.parse(content.responseBody)).toEqual({
      code: '401',
      status: 'UNAUTHORIZED',
      accessToken: '***',
      otp: '***',
    });
  });

  it('stores the body of an error response, whoever wrote it', async () => {
    const { content } = await fetchAndRecord('/demo/missing');

    expect(content.status).toBe(404);
    expect(JSON.parse(content.responseBody)).toEqual(
      hostFilter
        ? { success: false, status: 404 }
        : { statusCode: 404, message: 'no such thing', error: 'Not Found' },
    );
  });

  it('masks a long response before cutting it, so no secret survives the cut', async () => {
    const { res, content } = await fetchAndRecord('/demo/long-secret');

    expect(res.body.data).toHaveLength(30000);
    expect(content.responseBody).not.toContain('AT-SECRET');
    expect(content.responseBody).toContain('[truncated]');
    expect(content.responseBody.length).toBeLessThanOrEqual(10000 + 50);
  });

  it('does not hold a response over 256 KB, and still sends it whole', async () => {
    const { res, content } = await fetchAndRecord('/demo/huge');

    expect(res.body.data).toHaveLength(300000);
    expect(content.responseBody).toBe('[response larger than 256 KB, not recorded]');
  });

  it('does not store a non-text response, and still sends its bytes', async () => {
    const { res, content } = await fetchAndRecord('/demo/image');

    expect(res.body.toString()).toBe('not-really-a-png');
    expect(content.responseBody).toBe('[non-text response omitted]');
  });

  it('masks response headers by name, and still sends them', async () => {
    const { res, content } = await fetchAndRecord('/demo/cookie');

    expect(res.headers['x-api-key']).toBe('K-SECRET');
    expect(content.responseHeaders['set-cookie']).toBe('***');
    expect(content.responseHeaders['x-api-key']).toBe('***');
    expect(content.responseHeaders['content-type']).toContain('application/json');
  });

  it('masks the query string and the fragment of a redirect, and still sends the real address', async () => {
    const { res, content } = await fetchAndRecord('/demo/redirect');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('access_token=AT-SECRET');
    expect(content.responseHeaders.location).toBe(
      'https://app.example/cb?access_token=***&state=ok#id_token=***&x=1',
    );
  });

  it('masks the fields of a JSON document carried inside a string', async () => {
    const { content } = await fetchAndRecord('/demo/nested-json');

    expect(JSON.parse(content.responseBody)).toEqual({
      payload: { password: '***', ok: 1 },
      note: 'fine',
    });
  });

  it('masks a bare JWT sent as the whole body, and still sends it', async () => {
    const { res, content } = await fetchAndRecord('/demo/jwt-text');

    expect(res.text).toBe(SAMPLE_JWT);
    expect(content.responseBody).toBe('***');
  });

  it('stores an empty body for a 204', async () => {
    const { content } = await fetchAndRecord('/demo/empty');

    expect(content.status).toBe(204);
    expect(content.responseBody).toBe('');
  });

  it('does not read text in a wide charset as UTF-8, and still sends its bytes', async () => {
    // The client must not try to parse UTF-16 as JSON either.
    const res = await request(app.server)
      .get('/demo/wide')
      .buffer(true)
      .parse((response, done) => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('end', () => done(null, Buffer.concat(parts)));
      });
    const [entry] = await waitForRequests(app.storage, 1);

    expect((res.body as Buffer).toString('utf16le')).toBe('{"password":"PW-SECRET"}');
    expect(entry.content.responseBody).toBe('[non-text response omitted]');
  });

  it('reads a JSON response whose headers were handed to writeHead', async () => {
    const { res, content } = await fetchAndRecord('/demo/writehead');

    expect(res.text).toBe('{"token":"T-SECRET","a":1}');
    expect(JSON.parse(content.responseBody)).toEqual({ token: '***', a: 1 });
  });

  it('follows a response written in several pieces', async () => {
    const { res, content } = await fetchAndRecord('/demo/chunks');

    expect(res.text).toBe('{"a":1,"password":"PW-SECRET"}');
    expect(JSON.parse(content.responseBody)).toEqual({ a: 1, password: '***' });
  });
});
