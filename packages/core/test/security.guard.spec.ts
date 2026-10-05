import { ExecutionContext } from '@nestjs/common';
import { TelemetrySecurityGuard } from '../src/watchers/security.guard';

function mockExecutionContext(reqOverrides: any = {}) {
  const req = {
    path: '/telemetry/api/stats',
    query: {},
    headers: {},
    ...reqOverrides,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('TelemetrySecurityGuard', () => {
  it('enforces the access token for requests on basePath', () => {
    const guard = new TelemetrySecurityGuard('/telemetry', 'secret');

    const withoutToken = mockExecutionContext({ path: '/telemetry/api/stats' });
    expect(guard.canActivate(withoutToken)).toBe(false);

    const withToken = mockExecutionContext({
      path: '/telemetry/api/stats',
      query: { token: 'secret' },
    });
    expect(guard.canActivate(withToken)).toBe(true);
  });

  it('passes through requests outside basePath untouched', () => {
    const guard = new TelemetrySecurityGuard('/telemetry', 'secret');
    const ctx = mockExecutionContext({ path: '/api/users' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  // Documents the bug this guard used to have: when a consumer mounts the app behind a global
  // prefix (app.setGlobalPrefix('api/v1')), real requests to the dashboard arrive at
  // '/api/v1/telemetry/...', which does NOT start with the bare basePath ('/telemetry') — it
  // merely contains it. Constructing the guard with only basePath (the pre-fix behavior) makes
  // it think every real dashboard request is "not mine" and wave it through unconditionally,
  // without ever checking the access token.
  it('without externalBasePath, a global-prefix request bypasses the token check entirely (documents the bug)', () => {
    const guard = new TelemetrySecurityGuard('/telemetry', 'secret');
    const prefixedRequestNoToken = mockExecutionContext({
      path: '/api/v1/telemetry/api/stats',
    });
    expect(guard.canActivate(prefixedRequestNoToken)).toBe(true);
  });

  // The fix: the module resolves `opts.externalBasePath ?? opts.basePath` before constructing
  // the guard, so a consumer using a global prefix passes the real post-prefix path here.
  it('with externalBasePath set to the real prefixed path, the token check actually enforces', () => {
    const guard = new TelemetrySecurityGuard('/api/v1/telemetry', 'secret');

    const noToken = mockExecutionContext({ path: '/api/v1/telemetry/api/stats' });
    expect(guard.canActivate(noToken)).toBe(false);

    const wrongToken = mockExecutionContext({
      path: '/api/v1/telemetry/api/stats',
      query: { token: 'nope' },
    });
    expect(guard.canActivate(wrongToken)).toBe(false);

    const correctToken = mockExecutionContext({
      path: '/api/v1/telemetry/api/stats',
      headers: { 'x-telemetry-token': 'secret' },
    });
    expect(guard.canActivate(correctToken)).toBe(true);
  });

  it('allows any request through when no access token is configured', () => {
    const guard = new TelemetrySecurityGuard('/telemetry', '');
    const ctx = mockExecutionContext({ path: '/telemetry/api/stats' });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
