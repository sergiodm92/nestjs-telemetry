import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { TELEMETRY_OPTIONS } from '../telemetry.constants';
import { TelemetryModuleOptions } from '../telemetry.options';

/**
 * Asks for the access token on the dashboard's routes: the page (`?token=...`) and the JSON API
 * (`x-telemetry-token` header, or the same query parameter).
 *
 * It is bound to the dashboard's controller, not to the whole application, so Nest runs it on
 * exactly the requests it routes to the dashboard. It never compares paths: every spelling the
 * router accepts (`/Telemetry`, a trailing slash), any global prefix, a `basePath` written without
 * its leading slash, the mount point `forRootAsync` registered and any HTTP adapter all go through
 * the same check, and the application's own routes never reach it.
 */
@Injectable()
export class TelemetrySecurityGuard implements CanActivate {
  constructor(
    @Inject(TELEMETRY_OPTIONS)
    private readonly options: Pick<TelemetryModuleOptions, 'accessToken'>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.options.accessToken;
    if (!expected) return true;
    const req = context.switchToHttp().getRequest();
    return (
      sameToken(req?.query?.token, String(expected)) ||
      sameToken(req?.headers?.['x-telemetry-token'], String(expected))
    );
  }
}

/**
 * Compared in constant time, on digests so the length of a guess does not show either: how long
 * the answer takes says nothing about how much of the token a guess got right. A parameter given
 * twice (an array) is refused.
 */
function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given === '') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
