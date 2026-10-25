import {
  Injectable,
  Logger,
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

/**
 * Records one REQUEST entry per HTTP request, when its response ends.
 *
 * Not when the handler settles: Nest sets the success status (200/201) before the handler runs,
 * and the exception filter that writes the real 4xx/5xx status only runs after this interceptor's
 * observable has already errored. The status code is final only once the response itself ends.
 *
 * Requests that fail before reaching an interceptor (rejected by a guard, or matching no route)
 * are never seen here, so they are not recorded.
 */
@Injectable()
export class TelemetryRequestInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TelemetryRequestInterceptor.name);

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
      let recorded = false;
      const recordOnce = (): void => {
        if (recorded) return;
        recorded = true;
        this.recordSafely(req, res, batchId, start, userInfo);
      };

      // 'finish' is the normal end of a response; 'close' covers a connection that ended before
      // it finished. Whichever fires first records and the other is ignored. Fastify keeps the
      // Node response in `reply.raw`.
      const nodeRes = res?.raw ?? res;
      const watchesResponse = typeof nodeRes?.once === 'function';
      if (watchesResponse) {
        nodeRes.once('finish', recordOnce);
        nodeRes.once('close', recordOnce);
      }

      TelemetryContext.run(store, () => {
        const handled = next.handle();
        // A response object that cannot be watched is recorded when the handler settles instead:
        // the status may then still be the pre-set one, but the request is not lost.
        (watchesResponse
          ? handled
          : handled.pipe(tap({ next: recordOnce, error: recordOnce, complete: recordOnce }))
        ).subscribe(subscriber);
      });
    });
  }

  private recordSafely(
    req: any,
    res: any,
    batchId: string,
    start: number,
    userInfo: any,
  ): void {
    try {
      this.record(req, res, batchId, start, userInfo);
    } catch (err) {
      // This runs from a response event, where a throw would be an uncaught exception. Telemetry
      // only observes: it must never be able to take down the app it observes.
      this.logger.warn(
        `Could not record request: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
