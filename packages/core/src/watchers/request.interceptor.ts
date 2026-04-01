import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TelemetryContext } from '../context/telemetry-context';
import { TelemetryUserProvider } from '../context/telemetry-user.provider';

const MAX_BODY_LENGTH = 10000;
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie'];

@Injectable()
export class TelemetryRequestInterceptor implements NestInterceptor {
  constructor(
    private readonly storage: TelemetryStorage,
    private readonly userProvider: TelemetryUserProvider,
    private readonly ignoredPrefixes: string[],
    private readonly basePath: string,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const path: string = req.path || req.url || '';

    if (this.shouldIgnore(path)) {
      return next.handle();
    }

    const start = Date.now();
    const batchId = uuidv4();
    const userInfo = this.userProvider.getUser(req);

    const store = {
      batchId,
      userIdentifier: userInfo?.identifier,
      tenantId: userInfo?.tenantId,
    };

    return new Observable((subscriber) => {
      TelemetryContext.run(store, () => {
        next.handle().pipe(
          tap({
            next: () => {
              this.record(req, res, batchId, start, userInfo);
            },
            error: () => {
              this.record(req, res, batchId, start, userInfo);
            },
          }),
        ).subscribe(subscriber);
      });
    });
  }

  private record(
    req: any,
    res: any,
    batchId: string,
    start: number,
    userInfo: any,
  ): void {
    if (!this.storage.isEnabled()) return;

    const duration = Date.now() - start;
    const requestBody = this.truncateBody(req.body);

    this.storage.store({
      uuid: uuidv4(),
      type: TelemetryEntryType.REQUEST,
      createdAt: new Date(),
      batchId,
      content: {
        method: req.method,
        uri: req.path || req.url,
        queryString: req.originalUrl?.split('?')[1] || '',
        status: res.statusCode,
        duration,
        ipAddress: req.ip || req.connection?.remoteAddress || '',
        contentType: req.headers?.['content-type'] || '',
        responseContentType: '',
        requestHeaders: this.maskHeaders(req.headers || {}),
        requestBody,
      },
      userIdentifier: userInfo?.identifier || '',
      tenantId: userInfo?.tenantId || '',
      tags: [],
    });
  }

  private shouldIgnore(path: string): boolean {
    if (path.startsWith(this.basePath)) return true;
    return this.ignoredPrefixes.some((prefix) => path.startsWith(prefix));
  }

  private maskHeaders(headers: Record<string, any>): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      masked[key] = SENSITIVE_HEADERS.includes(key.toLowerCase())
        ? '***'
        : String(value);
    }
    return masked;
  }

  private truncateBody(body: any): string {
    if (!body) return '';
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    if (str.length > MAX_BODY_LENGTH) {
      return str.substring(0, MAX_BODY_LENGTH) + '... [truncated]';
    }
    return str;
  }
}
