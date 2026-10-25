import {
  ArgumentsHost,
  BadRequestException,
  CanActivate,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  INestApplication,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { from } from 'rxjs';
import { TELEMETRY_STORAGE } from '../../src/telemetry.constants';
import { TelemetryModule } from '../../src/telemetry.module';
import { TelemetryModuleOptions } from '../../src/telemetry.options';
import { SqliteTelemetryStorage } from '../../src/storage/sqlite.storage';
import { TelemetryStorage } from '../../src/storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../../src/model/telemetry-entry-type';

/** A well formed JWT (header and payload are JSON, signature is anything). */
export const SAMPLE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

/** A domain error the host's exception filter maps to a status Nest knows nothing about. */
export class DomainConflictError extends Error {}

class DenyAllGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

/** The host application's own routes, standing in for whatever the dashboard observes. */
@Controller('demo')
export class DemoController {
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Post('create')
  create() {
    return { created: true };
  }

  @Post('bad')
  bad() {
    throw new BadRequestException('bad input');
  }

  @Get('missing')
  missing() {
    throw new NotFoundException('no such thing');
  }

  @Get('boom')
  boom() {
    throw new Error('boom');
  }

  @Get('conflict')
  conflict() {
    throw new DomainConflictError('already taken');
  }

  /** The 400 comes from the ParseIntPipe, not from the handler. */
  @Get('items/:id')
  item(@Param('id', ParseIntPipe) id: number) {
    return { id };
  }

  /** An observable that emits several times before it completes. */
  @Get('many')
  many() {
    return from([1, 2, 3]);
  }

  /** What a login answers: tokens under the usual names, and a field that is safe to show. */
  @Get('login-result')
  loginResult() {
    return {
      user: 'ana',
      accessToken: 'AT-SECRET',
      refresh_token: 'RT-SECRET',
      profile: { name: 'Ana' },
    };
  }

  /** An error envelope like the ones APIs answer: `code` is a status code, `otp` is not. */
  @Get('coded')
  coded() {
    return { code: '401', status: 'UNAUTHORIZED', accessToken: 'AT-SECRET', otp: '123456' };
  }

  /** Far past the 10 000 characters the dashboard shows, with a secret first. */
  @Get('long-secret')
  longSecret() {
    return { accessToken: 'AT-SECRET', data: 'x'.repeat(30000) };
  }

  /** Larger than the 256 KB the watcher is willing to hold. */
  @Get('huge')
  huge() {
    return { data: 'x'.repeat(300000) };
  }

  /** Real bytes: a Buffer returned from a handler is serialised as JSON by Nest, so send it by hand. */
  @Get('image')
  image(@Res() res: any) {
    res.type('image/png').send(Buffer.from('not-really-a-png'));
  }

  /** Sets response headers a dashboard should never show. */
  @Get('cookie')
  cookie(@Res({ passthrough: true }) res: any) {
    res.setHeader('set-cookie', 'sid=SESSION-SECRET');
    res.setHeader('x-api-key', 'K-SECRET');
    return { ok: true };
  }

  /** Written in two pieces, with the secret in the second. */
  @Get('chunks')
  chunks(@Res() res: any) {
    res.type('application/json');
    res.write('{"a":');
    res.end('1,"password":"PW-SECRET"}');
  }

  /** Redirects with secrets in the query string and in the fragment. */
  @Get('redirect')
  redirect(@Res() res: any) {
    res.redirect(302, 'https://app.example/cb?access_token=AT-SECRET&state=ok#id_token=ID-SECRET&x=1');
  }

  /** A JSON value that is itself a JSON document, as an API with a payload column answers. */
  @Get('nested-json')
  nestedJson() {
    return { payload: JSON.stringify({ password: 'PW-SECRET', ok: 1 }), note: 'fine' };
  }

  /** A bare JWT as the whole body, under no field name at all. */
  @Get('jwt-text')
  jwtText(@Res() res: any) {
    res.type('text/plain').send(SAMPLE_JWT);
  }

  @Get('empty')
  @HttpCode(204)
  empty() {
    return undefined;
  }

  /** JSON in UTF-16: read as UTF-8, a NUL byte splits every field name. */
  @Get('wide')
  wide(@Res() res: any) {
    res
      .type('application/json; charset=utf-16le')
      .send(Buffer.from('{"password":"PW-SECRET"}', 'utf16le'));
  }

  /** Headers handed to writeHead never reach getHeader: this is how Fastify answers. */
  @Get('writehead')
  writeHead(@Res() res: any) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"token":"T-SECRET","a":1}');
  }

  /** Rejected by a guard, so the request never reaches an interceptor. */
  @UseGuards(DenyAllGuard)
  @Get('guarded')
  guarded() {
    return { never: 'reached' };
  }
}

/**
 * Mimics a host that standardizes its error responses: it writes the response itself, after the
 * interceptors have already seen the error. `delayMs` makes that write slow on purpose.
 */
@Catch()
export class HostExceptionFilter implements ExceptionFilter {
  static delayMs = 0;

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const res = host.switchToHttp().getResponse();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception instanceof DomainConflictError
          ? 409
          : 500;
    if (HostExceptionFilter.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, HostExceptionFilter.delayMs));
    }
    res.status(status).json({ success: false, status });
  }
}

export interface TestAppOptions {
  /** Options handed to TelemetryModule. `storage: 'sqlite'` gets a throwaway database file. */
  telemetry?: TelemetryModuleOptions;
  /** Register through forRootAsync, the way a host that reads its config does. */
  async?: boolean;
  /** app.setGlobalPrefix(...) */
  globalPrefix?: string;
  /** Register HostExceptionFilter as a global filter. */
  hostFilter?: boolean;
}

export interface TestApp {
  app: INestApplication;
  /** The http.Server to hand to supertest. */
  server: any;
  storage: TelemetryStorage;
  close(): Promise<void>;
}

/** A real Nest app (HTTP, routing, guards, interceptors, filters) with TelemetryModule installed. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestjs-telemetry-http-'));
  const telemetry: TelemetryModuleOptions = { ...options.telemetry };
  if (telemetry.storage === 'sqlite' && !telemetry.sqlitePath) {
    telemetry.sqlitePath = path.join(dir, 'telemetry.db');
  }

  const moduleRef = await Test.createTestingModule({
    imports: [
      options.async
        ? TelemetryModule.forRootAsync({
            basePath: telemetry.basePath,
            useFactory: () => telemetry,
          })
        : TelemetryModule.forRoot(telemetry),
    ],
    controllers: [DemoController],
    providers: options.hostFilter ? [{ provide: APP_FILTER, useClass: HostExceptionFilter }] : [],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  if (options.globalPrefix) app.setGlobalPrefix(options.globalPrefix);
  await app.init();

  const storage = app.get<TelemetryStorage>(TELEMETRY_STORAGE);
  return {
    app,
    server: app.getHttpServer(),
    storage,
    async close() {
      HostExceptionFilter.delayMs = 0;
      await app.close();
      if (storage instanceof SqliteTelemetryStorage) storage.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls until `done(value)` holds, or the timeout passes, and returns the last value read so a
 * failing assertion shows what was actually there. The entry for a request is written when its
 * response ends, which is only guaranteed to be around the time the client has the response.
 */
export async function eventually<T>(
  read: () => Promise<T> | T,
  done: (value: T) => boolean,
  timeoutMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await sleep(10);
  }
}

/** REQUEST entries, newest first. */
export function requestEntries(storage: TelemetryStorage) {
  return storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 1000);
}

/** Waits until at least `count` REQUEST entries exist, then lets stragglers show up. */
export async function waitForRequests(storage: TelemetryStorage, count: number) {
  const entries = await eventually(() => requestEntries(storage), (list) => list.length >= count);
  await sleep(30);
  return entries.length >= count ? requestEntries(storage) : entries;
}
