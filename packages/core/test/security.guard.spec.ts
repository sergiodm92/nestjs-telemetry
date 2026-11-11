import { ExecutionContext } from '@nestjs/common';
import { TelemetrySecurityGuard } from '../src/watchers/security.guard';

/** An Express-shaped request by default; `path` is irrelevant to the guard and set to show it. */
function contextFor(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const expressRequest = (extra: Record<string, unknown> = {}) =>
  contextFor({ path: '/telemetry/api/stats', query: {}, headers: {}, ...extra });

/** What Fastify hands a guard: no `path`, the whole URL in `url`, the query already parsed. */
const fastifyRequest = (url: string, query: Record<string, unknown>, headers: Record<string, unknown> = {}) =>
  contextFor({ url, query, headers, raw: {} });

describe('TelemetrySecurityGuard', () => {
  const guard = new TelemetrySecurityGuard({ accessToken: 'secret' });

  it('refuses a dashboard request without the token', () => {
    expect(guard.canActivate(expressRequest())).toBe(false);
  });

  it('refuses a wrong token, a longer one and a prefix of the right one', () => {
    for (const token of ['nope', 'secret-and-more', 'secre']) {
      expect(guard.canActivate(expressRequest({ query: { token } }))).toBe(false);
      expect(guard.canActivate(expressRequest({ headers: { 'x-telemetry-token': token } }))).toBe(false);
    }
  });

  it('accepts the token as the query parameter the page is opened with', () => {
    expect(guard.canActivate(expressRequest({ query: { token: 'secret' } }))).toBe(true);
  });

  it('accepts the token as the x-telemetry-token header the page sends with its API calls', () => {
    expect(guard.canActivate(expressRequest({ headers: { 'x-telemetry-token': 'secret' } }))).toBe(true);
  });

  it('refuses an empty token, and a parameter given twice', () => {
    expect(guard.canActivate(expressRequest({ query: { token: '' } }))).toBe(false);
    expect(guard.canActivate(expressRequest({ query: { token: ['secret', 'secret'] } }))).toBe(false);
  });

  // The guard is bound to the dashboard's controller: Nest already decided this is a dashboard
  // request, so the path it carries (any case, any prefix, none at all) changes nothing.
  it('does not look at the path', () => {
    for (const path of ['/Telemetry/api/stats', '/api/v1/telemetry/api/stats', '', undefined]) {
      expect(guard.canActivate(expressRequest({ path }))).toBe(false);
      expect(guard.canActivate(expressRequest({ path, query: { token: 'secret' } }))).toBe(true);
    }
  });

  it('checks a Fastify request, which has no `path`, the same way', () => {
    expect(guard.canActivate(fastifyRequest('/telemetry/api/stats', {}))).toBe(false);
    expect(guard.canActivate(fastifyRequest('/telemetry/api/stats?token=nope', { token: 'nope' }))).toBe(false);
    expect(guard.canActivate(fastifyRequest('/telemetry?token=secret', { token: 'secret' }))).toBe(true);
    expect(
      guard.canActivate(fastifyRequest('/telemetry/api/stats', {}, { 'x-telemetry-token': 'secret' })),
    ).toBe(true);
  });

  it('compares a token that is not a string (read from a config as a number) as its text', () => {
    const numeric = new TelemetrySecurityGuard({ accessToken: 1234 as unknown as string });
    expect(numeric.canActivate(expressRequest({ query: { token: '1234' } }))).toBe(true);
    expect(numeric.canActivate(expressRequest({ query: { token: '12345' } }))).toBe(false);
  });

  it('lets every request through when no access token is configured', () => {
    for (const accessToken of ['', undefined]) {
      const open = new TelemetrySecurityGuard({ accessToken });
      expect(open.canActivate(expressRequest())).toBe(true);
      expect(open.canActivate(fastifyRequest('/telemetry', {}))).toBe(true);
    }
  });
});
