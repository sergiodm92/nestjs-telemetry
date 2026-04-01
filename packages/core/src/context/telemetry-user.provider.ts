export interface TelemetryUserInfo {
  identifier: string;
  tenantId?: string;
}

export interface TelemetryUserProvider {
  getUser(request: any): TelemetryUserInfo | null;
}

export class DefaultTelemetryUserProvider implements TelemetryUserProvider {
  getUser(request: any): TelemetryUserInfo | null {
    const user = request?.user;
    if (!user) return null;
    const identifier =
      user.email || user.username || user.id || user.sub || String(user);
    return { identifier, tenantId: user.tenantId };
  }
}
