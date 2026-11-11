import request from 'supertest';
import { TestApp, createTestApp, waitForRequests } from './support/test-app';
import { redactText } from '../src/watchers/request.interceptor';
import { SAMPLE_JWT } from './support/test-app';

/**
 * The JWT shape is matched in every recorded body. Without an anchor the pattern is retried from
 * every `eyJ` of a long run of base64url characters, which is quadratic: a ~100 KB body held the
 * event loop for seconds, for any anonymous client of any route.
 */
describe('JWT masking on adversarial input', () => {
  let app: TestApp;

  afterEach(async () => {
    await app?.close();
  });

  it('records a 100 KB body of JWT lookalikes without stalling the request', async () => {
    app = await createTestApp();
    const body = JSON.stringify({ note: 'eyJ'.repeat(33_000) });

    const started = Date.now();
    await request(app.server).post('/demo/create').set('content-type', 'application/json').send(body).expect(201);
    const [entry] = await waitForRequests(app.storage, 1);

    expect(Date.now() - started).toBeLessThan(1500);
    expect(entry.content.uri).toBe('/demo/create');
  });

  it('still masks a JWT wherever it normally sits', () => {
    for (const text of [
      SAMPLE_JWT,
      `Bearer ${SAMPLE_JWT}`,
      `{"t":"${SAMPLE_JWT}"}`,
      `https://app.test/cb#id_token=${SAMPLE_JWT}`,
      `/sessions/${SAMPLE_JWT}/refresh`,
    ]) {
      expect(redactText(text)).not.toContain(SAMPLE_JWT);
    }
  });

  it('is linear on a megabyte of eyJ', () => {
    const started = Date.now();
    redactText('eyJ'.repeat(350_000));
    expect(Date.now() - started).toBeLessThan(500);
  });
});
