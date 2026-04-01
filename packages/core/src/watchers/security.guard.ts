import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class TelemetrySecurityGuard implements CanActivate {
  constructor(
    private readonly basePath: string,
    private readonly accessToken: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const path: string = req.path || '';
    if (!path.startsWith(this.basePath)) return true;
    if (!this.accessToken) return true;
    const queryToken = req.query?.token;
    const headerToken = req.headers?.['x-telemetry-token'];
    return queryToken === this.accessToken || headerToken === this.accessToken;
  }
}
