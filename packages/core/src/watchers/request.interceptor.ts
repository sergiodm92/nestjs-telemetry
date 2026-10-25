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
// Headers whose value is an address: its query string and fragment can carry a token (an OAuth
// redirect puts `?access_token=` or `#id_token=` in `Location`).
const URL_HEADERS = ['location', 'content-location', 'referer', 'refresh'];
const REDACTED = '***';
// A key is sensitive when its normalised form (lower-cased, without `-`, `_`, `.` or spaces, so
// `new_password`, `refreshToken`, `X-Api-Key` and `card number` all match) CONTAINS one of these.
// Over-masking (`tokenType`) is on purpose: a dashboard that hides one field too many is a
// nuisance, one that shows a credential is a leak.
const SENSITIVE_KEY_PARTS = [
  'password',
  'passwd',
  'passcode',
  'secret',
  'token',
  'apikey',
  'authorization',
  'cardnumber',
  'cvv',
  'cvc',
  'privatekey',
  'credential',
  'twofactor',
];
// Short names that would also hit innocent keys as a substring (`postcode`, `shipping`,
// `statusCode`), so the whole normalised key has to equal one.
const SENSITIVE_KEY_NAMES = [
  'code',
  'otp',
  'pin',
  'pwd',
  'pass',
  'jwt',
  'auth',
  'bearer',
  'cookie',
];
// A signed JWT is three base64url parts and the first two are JSON objects, so both start with
// `eyJ`. Matched by shape, wherever it sits: a token under an innocent key is still a token.
const JWT_PATTERN = /eyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]*/g;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s._-]/g, '');
  return (
    SENSITIVE_KEY_NAMES.includes(normalized) ||
    SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
  );
}

// Free text has no keys to compare: it is sensitive when it contains a long name anywhere, or has
// a short name as a word of its own.
function mentionsSensitiveKey(text: string): boolean {
  const compact = text.toLowerCase().replace(/[\s._-]/g, '');
  return (
    SENSITIVE_KEY_PARTS.some((part) => compact.includes(part)) ||
    text
      .split(/[^a-z0-9]+/i)
      .some((word) => SENSITIVE_KEY_NAMES.includes(word.toLowerCase()))
  );
}

// Runs for every key at every depth, arrays included, after `toJSON` (so a Date is already a string).
function redactReplacer(key: string, value: unknown): unknown {
  if (key && isSensitiveKey(key)) return REDACTED;
  if (typeof value !== 'string') return value;
  // A document carried as a string is read as one, so the fields inside it are masked too. What
  // is returned is walked by this same function, key by key.
  if (/^\s*[{[]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      // Not JSON after all: a plain string.
    }
  }
  return value.replace(JWT_PATTERN, REDACTED);
}

// Masks the value of every `key=value` pair whose key is sensitive; the rest is kept byte for byte.
function redactQueryString(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=');
      if (separator === -1) return pair;
      const rawKey = pair.slice(0, separator);
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        // A key that is not valid percent-encoding is compared as written.
      }
      return isSensitiveKey(key) ? `${rawKey}=${REDACTED}` : pair;
    })
    .join('&');
}

// An address with the query string and the fragment masked the way a query string is.
function redactUrl(value: string): string {
  const hash = value.indexOf('#');
  const beforeHash = hash === -1 ? value : value.slice(0, hash);
  const fragment = hash === -1 ? '' : `#${redactQueryString(value.slice(hash + 1))}`;
  const query = beforeHash.indexOf('?');
  const address =
    query === -1
      ? beforeHash
      : `${beforeHash.slice(0, query + 1)}${redactQueryString(beforeHash.slice(query + 1))}`;
  return address + fragment;
}

// A text body is JSON often enough (a client that omits the content type) to be worth parsing; one
// that is not is kept only when it never names a sensitive field (`password=...&email=...`).
function redactText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), redactReplacer);
  } catch {
    const masked = text.replace(JWT_PATTERN, REDACTED);
    return mentionsSensitiveKey(masked) ? REDACTED : masked;
  }
}

function truncate(text: string): string {
  return text.length > MAX_BODY_LENGTH
    ? text.substring(0, MAX_BODY_LENGTH) + '... [truncated]'
    : text;
}

// Kept whole before it is masked: cutting a JSON document first would leave half of it, which no
// longer parses and so could not be masked by field. A larger response is not recorded at all.
const MAX_RESPONSE_CAPTURE_BYTES = 256 * 1024;
const TEXTUAL_CONTENT_TYPE =
  /^(?:application\/(?:[\w.+-]+\+)?(?:json|xml)|text\/(?!event-stream))/i;
// Text in UTF-16 or UTF-32 is read here as UTF-8, where a NUL byte splits every field name.
const WIDE_CHARSET = /charset\s*=\s*"?(?:utf-?16|utf-?32|ucs)/i;
const NON_TEXT_RESPONSE = '[non-text response omitted]';
const OVERSIZED_RESPONSE = '[response larger than 256 KB, not recorded]';

type HeaderReader = (name: string) => unknown;

/**
 * `true` for text this watcher can read, `false` for anything else (binary, compressed, an event
 * stream, wide characters), `undefined` while there is no content type to tell by: a host that
 * hands its headers to `writeHead(status, headers)` (Fastify does) never calls `setHeader`.
 */
function responseTextKind(header: HeaderReader): boolean | undefined {
  const encoding = String(header('content-encoding') ?? 'identity').toLowerCase();
  if (encoding !== 'identity') return false;
  const type = header('content-type');
  if (type === undefined || type === null || type === '') return undefined;
  const value = String(type);
  return TEXTUAL_CONTENT_TYPE.test(value) && !WIDE_CHARSET.test(value);
}

/** HEAD, 204 and 304 have no body: whatever is handed to `end` is dropped by Node, not sent. */
function responseHasBody(nodeRes: any): boolean {
  return (
    nodeRes?.req?.method !== 'HEAD' && nodeRes?.statusCode !== 204 && nodeRes?.statusCode !== 304
  );
}

/**
 * Copies what the client is sent, without changing it: the Node response's `write` and `end` are
 * wrapped, every text chunk is kept (up to MAX_RESPONSE_CAPTURE_BYTES) and handed on untouched.
 * The response is the only place that holds the error body: the host's exception filter writes it
 * after the interceptors have already seen the error. Returns a reader to call once the response
 * has ended (`finished` is false when the connection closed first), or `undefined` when the
 * response cannot be watched.
 */
export function watchResponseBody(
  nodeRes: any,
  header: HeaderReader = (name) => nodeRes?.getHeader?.(name),
): ((finished: boolean) => string) | undefined {
  if (typeof nodeRes?.write !== 'function' || typeof nodeRes?.end !== 'function') {
    return undefined;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let state: 'open' | 'non-text' | 'oversized' = 'open';
  let typeKnown = false;
  let insideEnd = false;

  const collect = (chunk: unknown, encoding: unknown): void => {
    // After `end` nothing more is sent, so nothing more is recorded.
    if (state !== 'open' || nodeRes.writableEnded) return;
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
    // Stop buffering at once when the response is known not to be text. While the content type is
    // still unknown, keep going: the decision is made when the response is read, headers final.
    if (!typeKnown) {
      const kind = responseTextKind(header);
      if (kind === false) {
        state = 'non-text';
        return;
      }
      typeKnown = kind === true;
    }
    const characters = typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8';
    const incoming =
      chunk instanceof Uint8Array
        ? chunk.byteLength
        : typeof chunk === 'string'
          ? Buffer.byteLength(chunk, characters)
          : 0;
    // Checked before copying: one huge write must not be duplicated just to be thrown away.
    if (size + incoming > MAX_RESPONSE_CAPTURE_BYTES) {
      state = 'oversized';
      chunks.length = 0;
      return;
    }
    if (incoming === 0) return;
    size += incoming;
    // A Buffer is a Uint8Array, and `write` accepts both. The copy keeps a caller that reuses its
    // buffer after writing from changing what was recorded.
    chunks.push(
      chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : Buffer.from(chunk as string, characters),
    );
  };

  // Telemetry only observes: a failure to copy a chunk must never reach the client's response.
  const collectSafely = (args: unknown[]): void => {
    try {
      collect(args[0], args[1]);
    } catch {
      state = 'non-text';
      chunks.length = 0;
    }
  };

  const write = nodeRes.write;
  const end = nodeRes.end;
  try {
    nodeRes.write = function (this: unknown, ...args: unknown[]) {
      // HTTP/2's compatibility response implements `end` through `write`: the chunk was already
      // copied by `end`.
      if (!insideEnd) collectSafely(args);
      return write.apply(this, args);
    };
    nodeRes.end = function (this: unknown, ...args: unknown[]) {
      collectSafely(args);
      const wasInsideEnd = insideEnd;
      insideEnd = true;
      try {
        return end.apply(this, args);
      } finally {
        insideEnd = wasInsideEnd;
      }
    };
  } catch (err) {
    // A response that refuses the wrapper (frozen, proxied) is left as it was.
    nodeRes.write = write;
    throw err;
  }

  return (finished: boolean) => {
    if (state === 'non-text') return NON_TEXT_RESPONSE;
    if (state === 'oversized') return OVERSIZED_RESPONSE;
    const text = Buffer.concat(chunks).toString('utf8');
    chunks.length = 0;
    if (!text || !responseHasBody(nodeRes)) return '';
    const kind = responseTextKind(header);
    if (kind === false) return NON_TEXT_RESPONSE;
    if (kind === undefined) {
      // No content type to go by: only a JSON document is read, and it is masked as JSON.
      try {
        JSON.parse(text);
      } catch {
        return NON_TEXT_RESPONSE;
      }
    }
    const body = redactText(text);
    return finished ? body : `${body} [response incomplete: the connection closed first]`;
  };
}

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
      // 'finish' is the normal end of a response; 'close' covers a connection that ended before
      // it finished. Whichever fires first records and the other is ignored. Fastify keeps the
      // Node response in `reply.raw`.
      const nodeRes = res?.raw ?? res;
      const watchesResponse = typeof nodeRes?.once === 'function';
      const readResponseBody =
        watchesResponse && this.storage.isEnabled()
          ? this.watchResponse(nodeRes, res)
          : undefined;

      let recorded = false;
      const recordOnce = (): void => {
        if (recorded) return;
        recorded = true;
        this.recordSafely(req, res, batchId, start, userInfo, readResponseBody);
      };

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

  // The framework's own response (Fastify's reply) is asked too: its headers are not always on
  // the Node response yet.
  private watchResponse(nodeRes: any, res: any): ((finished: boolean) => string) | undefined {
    try {
      return watchResponseBody(
        nodeRes,
        (name) => nodeRes.getHeader?.(name) ?? res?.getHeader?.(name),
      );
    } catch (err) {
      this.logger.warn(
        `Could not watch the response: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  private recordSafely(
    req: any,
    res: any,
    batchId: string,
    start: number,
    userInfo: any,
    readResponseBody?: (finished: boolean) => string,
  ): void {
    try {
      this.record(req, res, batchId, start, userInfo, readResponseBody);
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
    readResponseBody?: (finished: boolean) => string,
  ): void {
    if (!this.storage.isEnabled()) return;

    const duration = Date.now() - start;
    const requestBody = this.truncateBody(req.body);
    const nodeRes = res?.raw ?? res;
    const responseBody = readResponseBody
      ? truncate(readResponseBody(nodeRes?.writableFinished === true))
      : '';
    const responseHeaders = {
      ...(nodeRes?.getHeaders?.() ?? {}),
      ...(res !== nodeRes ? (res?.getHeaders?.() ?? {}) : {}),
    };

    this.storage.store({
      uuid: uuidv4(),
      type: TelemetryEntryType.REQUEST,
      createdAt: new Date(),
      batchId,
      content: {
        method: req.method,
        uri: req.path || req.url,
        queryString: redactQueryString(req.originalUrl?.split('?')[1] || ''),
        status: res.statusCode,
        duration,
        ipAddress: req.ip || req.connection?.remoteAddress || '',
        contentType: req.headers?.['content-type'] || '',
        responseContentType: String(
          nodeRes?.getHeader?.('content-type') ?? res?.getHeader?.('content-type') ?? '',
        ),
        requestHeaders: this.maskHeaders(req.headers || {}),
        requestBody,
        responseHeaders: this.maskHeaders(responseHeaders),
        responseBody,
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
      const lower = key.toLowerCase();
      masked[key] =
        SENSITIVE_HEADERS.includes(lower) || isSensitiveKey(key)
          ? REDACTED
          : URL_HEADERS.includes(lower)
            ? redactUrl(String(value))
            : String(value);
    }
    return masked;
  }

  private truncateBody(body: any): string {
    if (!body) return '';
    // A raw body (`express.raw`) would serialise as a list of byte values nobody reads but anyone
    // can decode.
    if (Buffer.isBuffer(body)) return '[binary body omitted]';
    // Redact before truncating: cutting first could leave half a JSON document that no longer parses.
    const str =
      typeof body === 'string'
        ? redactText(body)
        : JSON.stringify(body, redactReplacer);
    return truncate(str);
  }
}
