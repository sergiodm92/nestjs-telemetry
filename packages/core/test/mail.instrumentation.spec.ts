import { Controller, INestApplication, Inject, Injectable, Module, OnModuleInit, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import request from 'supertest';
import { TelemetryModule } from '../src/telemetry.module';
import { TelemetryModuleOptions } from '../src/telemetry.options';
import { TELEMETRY_STORAGE } from '../src/telemetry.constants';
import { TelemetryStorage } from '../src/storage/telemetry-storage.interface';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { TelemetryContext } from '../src/context/telemetry-context';
import { TelemetryMailWatcher, mailSourceOf } from '../src/watchers/mail.watcher';
import { eventually, sleep } from './support/test-app';

const mailEntries = (storage: TelemetryStorage) => storage.getByType(TelemetryEntryType.MAIL, {}, 0, 100);
const hasOwnSendMail = (target: object) => Object.prototype.hasOwnProperty.call(target, 'sendMail');
const jsonTransport = (defaults?: object) => nodemailer.createTransport({ jsonTransport: true }, defaults as any);

/** nodemailer's shape without nodemailer: sendMail() on the prototype, use(), and a transport under `transporter`. */
class FakeTransporter {
  readonly transporter = { name: 'FakeTransport', version: '1.0.0', send: () => undefined };
  _defaults: Record<string, unknown> = {};
  failWith: unknown = null;
  calls = 0;

  use(): this {
    return this;
  }

  sendMail(data: any, callback?: (err: unknown, info?: any) => void): any {
    const outcome = () => {
      this.calls++;
      if (this.failWith !== null) throw this.failWith;
      const to = ([] as unknown[]).concat(data?.to ?? []);
      return { messageId: `<${this.calls}@fake.test>`, accepted: to, rejected: [], envelope: { to } };
    };
    if (callback) {
      setImmediate(() => {
        let info: unknown;
        try {
          info = outcome();
        } catch (err) {
          return callback(err);
        }
        callback(null, info);
      });
      return undefined;
    }
    return new Promise((resolve, reject) =>
      setImmediate(() => {
        try {
          resolve(outcome());
        } catch (err) {
          reject(err);
        }
      }),
    );
  }
}

/** A template engine the way @nestjs-modules/mailer plugs one in: a nodemailer compile plugin. */
function useTemplates(transporter: nodemailer.Transporter): void {
  transporter.use('compile', (mail: any, done: (err?: Error | null) => void) => {
    const { template, context } = mail.data;
    if (!template || mail.data.html) return done();
    if (template === 'missing') return done(new Error(`Template not found: ${template}`));
    mail.data.html = `<h1>Hola ${context?.name}</h1><p>Tu pedido ${context?.order} salió.</p>`;
    done();
  });
}

/**
 * What @nestjs-modules/mailer's MailerService looks like from the outside: same class name, a
 * default nodemailer transporter, named ones in a Map, templates rendered by a compile plugin.
 */
class MailerService {
  private readonly transporter: nodemailer.Transporter;
  private readonly transporters = new Map<string, nodemailer.Transporter>();

  constructor(transporter: nodemailer.Transporter = jsonTransport({ from: 'OrderNow <noreply@x.test>' })) {
    useTemplates(transporter);
    this.transporter = transporter;
  }

  addTransporter(name: string, transporter: nodemailer.Transporter): string {
    useTemplates(transporter);
    this.transporters.set(name, transporter);
    return name;
  }

  async sendMail(options: any): Promise<any> {
    const transporter = options.transporterName ? this.transporters.get(options.transporterName)! : this.transporter;
    return transporter.sendMail(options);
  }
}

describe('mailSourceOf', () => {
  it('knows a nodemailer transporter and a MailerService, and nothing else', () => {
    class UserMailService {
      sendMail(_user: unknown, _template: string): void {}
    }
    /** What `nest g service mailer` gives a host: same name, its own contract. */
    class HostMailerService {
      sendMail(_to: string, _subject: string, _html: string): void {}
      addTransporter(): void {}
    }
    Object.defineProperty(HostMailerService, 'name', { value: 'MailerService' });

    expect(mailSourceOf(jsonTransport())).toBe('nodemailer');
    expect(mailSourceOf(new FakeTransporter())).toBe('nodemailer');
    expect(mailSourceOf(new MailerService())).toBe('mailer');
    expect(mailSourceOf(new HostMailerService())).toBeUndefined();
    expect(mailSourceOf(new UserMailService())).toBeUndefined();
    expect(mailSourceOf({ sendMail() {} })).toBeUndefined();
    expect(mailSourceOf(null)).toBeUndefined();
    expect(mailSourceOf('sendMail')).toBeUndefined();
  });

  it('is not fooled by an auto-mocking proxy, and does not make it grow properties', () => {
    // jest-mock-extended's mock<T>(): any property asked for comes back as a fresh jest.fn().
    const asked: string[] = [];
    const autoMock = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, key) {
        if (typeof key === 'string') asked.push(key);
        if (!(key in target)) target[key] = jest.fn();
        return target[key];
      },
    });

    expect(mailSourceOf(autoMock)).toBeUndefined();
    expect(asked).toEqual([]);
  });
});

describe('TelemetryMailWatcher.instrument', () => {
  let storage: InMemoryTelemetryStorage;
  let watcher: TelemetryMailWatcher;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    watcher = new TelemetryMailWatcher(storage);
  });

  afterEach(() => watcher.restore());

  it('records a promise-style send and hands back exactly what the transporter returned', async () => {
    const transporter = watcher.instrument(new FakeTransporter());

    const info = await transporter.sendMail({ from: 'app@x.test', to: 'ana@x.test', subject: 'Hi', text: 'hello' });

    expect(info.messageId).toBe('<1@fake.test>');
    const [entry] = await mailEntries(storage);
    expect(entry.content).toMatchObject({
      to: 'ana@x.test',
      from: 'app@x.test',
      subject: 'Hi',
      bodyPreview: 'hello',
      status: 'sent',
      messageId: '<1@fake.test>',
      accepted: ['ana@x.test'],
      transport: 'FakeTransport',
      source: 'nodemailer',
    });
    expect(typeof entry.content.duration).toBe('number');
  });

  it('records a failed send and rejects with the very same error', async () => {
    const transporter = watcher.instrument(new FakeTransporter());
    const failure = Object.assign(new Error('Invalid login: 535 Authentication failed'), { code: 'EAUTH' });
    transporter.failWith = failure;

    await expect(transporter.sendMail({ to: 'ana@x.test', subject: 'Hi' })).rejects.toBe(failure);

    const [entry] = await mailEntries(storage);
    expect(entry.content.status).toBe('failed');
    expect(entry.content.error).toBe('Invalid login: 535 Authentication failed');
    expect(entry.tags).toContain('mail:failed');
  });

  it('records a rejection without a reason as a failure', async () => {
    const target = { sendMail: () => Promise.reject(undefined) };
    watcher.instrument(target);

    await expect(target.sendMail()).rejects.toBeUndefined();

    const [entry] = await mailEntries(storage);
    expect(entry.content.status).toBe('failed');
  });

  it('records a callback-style send and calls the callback with the transporter result', async () => {
    const transporter = watcher.instrument(new FakeTransporter());

    const outcome = await new Promise<{ err: unknown; info: any; returned: unknown }>((resolve) => {
      const returned = transporter.sendMail({ to: 'bob@x.test', subject: 'cb' }, (err, info) =>
        resolve({ err, info, returned }),
      );
    });

    expect(outcome.err).toBeNull();
    expect(outcome.info.messageId).toBe('<1@fake.test>');
    expect(outcome.returned).toBeUndefined();
    const [entry] = await mailEntries(storage);
    expect(entry.content).toMatchObject({ to: 'bob@x.test', status: 'sent' });
  });

  it('records a callback-style failure and passes the error to the callback', async () => {
    const transporter = watcher.instrument(new FakeTransporter());
    transporter.failWith = new Error('Connection timeout');

    const err = await new Promise((resolve) => transporter.sendMail({ to: 'a@x.test' }, (e) => resolve(e)));

    expect(err).toBe(transporter.failWith);
    const [entry] = await mailEntries(storage);
    expect(entry.content).toMatchObject({ status: 'failed', error: 'Connection timeout' });
  });

  it('records, and rethrows, a sendMail that throws synchronously, with or without a callback', async () => {
    const target = {
      sendMail(_options?: unknown, _callback?: unknown): never {
        throw new TypeError('bad options');
      },
    };
    watcher.instrument(target, 'manual');

    expect(() => target.sendMail({ to: 'a@x.test' })).toThrow('bad options');
    expect(() => target.sendMail({ to: 'b@x.test' }, () => undefined)).toThrow('bad options');

    const entries = await eventually(() => mailEntries(storage), (list) => list.length === 2);
    expect(entries.map((e) => e.content.status)).toEqual(['failed', 'failed']);
    expect(entries[0].content).toMatchObject({ error: 'bad options', source: 'manual' });
  });

  it('includes the transporter defaults, as nodemailer does', async () => {
    const transporter = new FakeTransporter();
    transporter._defaults = { from: { name: 'OrderNow', address: 'noreply@x.test' }, replyTo: 'help@x.test' };
    watcher.instrument(transporter);

    await transporter.sendMail({ to: 'ana@x.test', subject: 'Hi' });

    const [entry] = await mailEntries(storage);
    expect(entry.content.from).toBe('OrderNow <noreply@x.test>');
    expect(entry.content.replyTo).toBe('help@x.test');
  });

  it('records the options as they were when the send started, even if the caller reuses the object', async () => {
    const target = { sendMail: (_options: unknown) => new Promise((resolve) => setTimeout(() => resolve({}), 5)) };
    watcher.instrument(target);
    const options = { to: 'ana@x.test', subject: 'First' };

    const first = target.sendMail(options);
    options.to = 'bob@x.test';
    options.subject = 'Second';
    await Promise.all([first, target.sendMail(options)]);

    const recorded = (await mailEntries(storage)).map((e) => `${e.content.to}:${e.content.subject}`).sort();
    expect(recorded).toEqual(['ana@x.test:First', 'bob@x.test:Second']);
  });

  it('wraps an object once, however many times or by however many watchers it is instrumented', async () => {
    const transporter = new FakeTransporter();
    watcher.instrument(transporter);
    watcher.instrument(transporter);
    const other = new TelemetryMailWatcher(storage);
    other.instrument(transporter);

    await transporter.sendMail({ to: 'a@x.test' });

    expect(await mailEntries(storage)).toHaveLength(1);
    other.restore();
  });

  it('records a mail sent from the callback of another one as a send of its own', async () => {
    const transporter = watcher.instrument(new FakeTransporter());

    await new Promise<void>((resolve) =>
      transporter.sendMail({ to: 'first@x.test' }, () => {
        transporter.sendMail({ to: 'second@x.test' }, () => resolve());
      }),
    );

    const recipients = (await mailEntries(storage)).map((e) => e.content.to).sort();
    expect(recipients).toEqual(['first@x.test', 'second@x.test']);
  });

  it('does not record while recording is paused, and leaves the object alone when watchers.mail is off', async () => {
    const paused = watcher.instrument(new FakeTransporter());
    storage.setEnabled(false);
    await paused.sendMail({ to: 'a@x.test' });
    storage.setEnabled(true);

    const off = new TelemetryMailWatcher(storage, false);
    const untouched = off.instrument(new FakeTransporter());
    await untouched.sendMail({ to: 'b@x.test' });

    expect(hasOwnSendMail(untouched)).toBe(false);
    expect(paused.calls + untouched.calls).toBe(2);
    expect(await mailEntries(storage)).toHaveLength(0);
  });

  it('never wraps a jest mock, so the test that made it can still assert on it', async () => {
    const mocked = { sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }) };
    const original = mocked.sendMail;
    watcher.instrument(mocked);

    const transporter = jsonTransport();
    const spy = jest.spyOn(transporter, 'sendMail');
    watcher.instrument(transporter);
    await transporter.sendMail({ to: 'ana@x.test', subject: 'Spied', text: 'hi' });

    expect(mocked.sendMail).toBe(original);
    expect(transporter.sendMail).toBe(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    // The send still reached the transport, which is where it is recorded.
    const [entry] = await mailEntries(storage);
    expect(entry.content.subject).toBe('Spied');
    spy.mockRestore();
  });

  it('puts every method back on restore()', async () => {
    const transporter = jsonTransport();
    const transport = (transporter as any).transporter;
    watcher.instrument(transporter);
    expect(hasOwnSendMail(transporter)).toBe(true);

    watcher.restore();

    expect(hasOwnSendMail(transporter)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(transport, 'send')).toBe(false);
    await transporter.sendMail({ to: 'a@x.test' });
    expect(await mailEntries(storage)).toHaveLength(0);
  });

  it('hands a shared transporter to the newest live watcher, then back, then lets go of it', async () => {
    const otherStorage = new InMemoryTelemetryStorage(100);
    const newer = new TelemetryMailWatcher(otherStorage);
    const transporter = jsonTransport();
    watcher.instrument(transporter);
    newer.instrument(transporter);

    await transporter.sendMail({ to: 'one@x.test' });
    newer.restore();
    await transporter.sendMail({ to: 'two@x.test' });
    watcher.restore();
    await transporter.sendMail({ to: 'three@x.test' });

    expect((await mailEntries(otherStorage)).map((e) => e.content.to)).toEqual(['one@x.test']);
    expect((await mailEntries(storage)).map((e) => e.content.to)).toEqual(['two@x.test']);
    expect(hasOwnSendMail(transporter)).toBe(false);
  });

  it('lets a wrapper put back after its watcher is gone pass calls through', async () => {
    const transporter = jsonTransport();
    watcher.instrument(transporter);
    const stale = (transporter as any).sendMail;
    watcher.restore();
    // What a spy's mockRestore() can do: put back the function it found, our wrapper.
    Object.defineProperty(transporter, 'sendMail', { value: stale, configurable: true, writable: true });

    await transporter.sendMail({ to: 'a@x.test' });
    expect(await mailEntries(storage)).toHaveLength(0);

    const next = new TelemetryMailWatcher(storage);
    next.instrument(transporter);
    await transporter.sendMail({ to: 'b@x.test' });
    expect((await mailEntries(storage)).map((e) => e.content.to)).toEqual(['b@x.test']);
    next.restore();
  });

  describe('with real nodemailer', () => {
    it('records what the transport sends', async () => {
      const transporter = watcher.instrument(jsonTransport({ from: 'OrderNow <noreply@x.test>' }));

      const info = await transporter.sendMail({
        to: [{ name: 'Ana', address: 'ana@x.test' }],
        subject: '¡Bienvenido!',
        html: '<h1>Hola Ana</h1><p>Gracias por registrarte.</p>',
      });

      const [entry] = await mailEntries(storage);
      expect(entry.content).toMatchObject({
        to: 'Ana <ana@x.test>',
        from: 'OrderNow <noreply@x.test>',
        subject: '¡Bienvenido!',
        bodyPreview: 'Hola Ana\nGracias por registrarte.',
        messageId: info.messageId,
        transport: 'JSONTransport',
        status: 'sent',
      });
    });

    it('records the HTML a template plugin rendered, and the template name', async () => {
      const transporter = jsonTransport();
      useTemplates(transporter);
      watcher.instrument(transporter);

      await transporter.sendMail({ to: 'ana@x.test', subject: 'Envío', template: 'order-shipped', context: { name: 'Ana', order: 42 } } as any);

      const [entry] = await mailEntries(storage);
      expect(entry.content).toMatchObject({ template: 'order-shipped', type: 'html', bodyPreview: 'Hola Ana\nTu pedido 42 salió.' });
      expect(entry.content.html).toContain('<h1>Hola Ana</h1>');
    });

    it('records a send that fails before it reaches the transport', async () => {
      const transporter = jsonTransport({ from: 'noreply@x.test' });
      useTemplates(transporter);
      watcher.instrument(transporter);

      await expect(
        transporter.sendMail({ to: 'ana@x.test', subject: 'Envío', template: 'missing' } as any),
      ).rejects.toThrow('Template not found: missing');

      const [entry] = await mailEntries(storage);
      expect(entry.content).toMatchObject({
        status: 'failed',
        error: 'Template not found: missing',
        to: 'ana@x.test',
        from: 'noreply@x.test',
        template: 'missing',
      });
    });

    it('records a MailerService send once, rendered, including transporters added later', async () => {
      const mailer = new MailerService();
      watcher.instrument(mailer);
      mailer.addTransporter('marketing', jsonTransport({ from: 'news@x.test' }));

      await mailer.sendMail({ to: 'ana@x.test', subject: 'Envío', template: 'order-shipped', context: { name: 'Ana', order: 7 } });
      await mailer.sendMail({ to: 'bob@x.test', subject: 'News', text: 'hello', transporterName: 'marketing' });

      const entries = await mailEntries(storage);
      expect(entries).toHaveLength(2);
      const [news, shipped] = entries;
      expect(shipped.content).toMatchObject({ source: 'mailer', template: 'order-shipped', from: 'OrderNow <noreply@x.test>' });
      expect(shipped.content.html).toContain('Tu pedido 7');
      expect(news.content).toMatchObject({ source: 'mailer', from: 'news@x.test', to: 'bob@x.test' });
    });

    it('keeps the batch of the code that sent the mail, wherever the transport calls back from', async () => {
      const pending: Array<() => void> = [];
      const transporter = nodemailer.createTransport({
        name: 'Deferred',
        version: '1.0.0',
        send(_mail: unknown, done: (err: Error | null, info: unknown) => void) {
          pending.push(() => done(null, { messageId: '<deferred@x.test>', envelope: {} }));
        },
      } as any);
      watcher.instrument(transporter);

      const delivered = new Promise((resolve) =>
        TelemetryContext.run({ batchId: 'request-1', userIdentifier: 'ana', tenantId: 'tenant-a' }, () =>
          transporter.sendMail({ to: 'ana@x.test', subject: 'pooled' }, resolve),
        ),
      );
      await eventually(() => pending.length, (count) => count === 1);
      // A pooled connection calls back from whatever context it was opened in.
      TelemetryContext.run({ batchId: 'request-2', userIdentifier: 'bob', tenantId: 'tenant-b' }, () => pending[0]());
      await delivered;

      const [entry] = await mailEntries(storage);
      expect(entry).toMatchObject({ batchId: 'request-1', userIdentifier: 'ana', tenantId: 'tenant-a' });
    });
  });
});

// ── the module finds the senders by itself ──────────────────────────────

const MAIL_TRANSPORTER = 'MAIL_TRANSPORTER';

/** How a host typically wires nodemailer: the transporter is a provider of its own. */
@Injectable()
class TokenEmailService {
  constructor(@Inject(MAIL_TRANSPORTER) private readonly transporter: { sendMail(options: object): Promise<unknown> }) {}

  send(to: string): Promise<unknown> {
    return this.transporter.sendMail({
      from: 'noreply@app.test',
      to,
      subject: 'Welcome',
      html: '<h1>Hi</h1><p>Welcome aboard</p>',
    });
  }
}

/** The other usual way: the service creates its transporter and keeps it in a field. */
@Injectable()
class FieldEmailService {
  private readonly transporter = jsonTransport();

  send(to: string): Promise<unknown> {
    return this.transporter.sendMail({ from: 'field@app.test', to, subject: 'From a field', text: 'plain' });
  }
}

@Controller('mail')
class MailController {
  constructor(
    private readonly tokenMail: TokenEmailService,
    private readonly fieldMail: FieldEmailService,
  ) {}

  @Post('token')
  async token() {
    await this.tokenMail.send('ana@x.test');
    return { ok: true };
  }

  @Post('field')
  async field() {
    await this.fieldMail.send('bob@x.test');
    return { ok: true };
  }
}

interface MailApp {
  app: INestApplication;
  server: any;
  storage: TelemetryStorage;
  transporter: object;
}

async function createMailApp(telemetry: TelemetryModuleOptions = {}, useAsync = false): Promise<MailApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      useAsync
        ? TelemetryModule.forRootAsync({ useFactory: () => telemetry })
        : TelemetryModule.forRoot(telemetry),
    ],
    controllers: [MailController],
    providers: [{ provide: MAIL_TRANSPORTER, useFactory: () => jsonTransport() }, TokenEmailService, FieldEmailService],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return {
    app,
    server: app.getHttpServer(),
    storage: app.get<TelemetryStorage>(TELEMETRY_STORAGE),
    transporter: app.get(MAIL_TRANSPORTER),
  };
}

async function createAppWith(imports: any[], providers: any[] = []): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports, providers }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('mail sent by the host application', () => {
  let current: INestApplication | undefined;

  afterEach(async () => {
    await current?.close();
    current = undefined;
  });

  it('is recorded with no code in the host, in the batch of the request that sent it', async () => {
    const mailApp = await createMailApp();
    current = mailApp.app;

    await request(mailApp.server).post('/mail/token').expect(201);

    const storage = mailApp.storage;
    const [mail] = await eventually(() => mailEntries(storage), (list) => list.length === 1);
    expect(mail.content).toMatchObject({
      to: 'ana@x.test',
      from: 'noreply@app.test',
      subject: 'Welcome',
      bodyPreview: 'Hi\nWelcome aboard',
      status: 'sent',
      source: 'nodemailer',
      transport: 'JSONTransport',
    });
    const requests = await eventually(
      () => storage.getByType(TelemetryEntryType.REQUEST, {}, 0, 10),
      (list) => list.length === 1,
    );
    expect(mail.batchId).toBeTruthy();
    expect(mail.batchId).toBe(requests[0].batchId);
  });

  it('is recorded when the transporter lives in a field of a service', async () => {
    const mailApp = await createMailApp();
    current = mailApp.app;

    await request(mailApp.server).post('/mail/field').expect(201);

    const storage = mailApp.storage;
    const [mail] = await eventually(() => mailEntries(storage), (list) => list.length === 1);
    expect(mail.content).toMatchObject({ to: 'bob@x.test', from: 'field@app.test', type: 'text' });
  });

  it('reaches the Mail view of the dashboard', async () => {
    const mailApp = await createMailApp();
    current = mailApp.app;
    await request(mailApp.server).post('/mail/token').expect(201);

    const server = mailApp.server;
    const res = await eventually(
      () => request(server).get('/telemetry/api/entries?type=MAIL'),
      (r) => r.body?.data?.total === 1,
    );

    expect(res.body.data.entries[0].content.subject).toBe('Welcome');
    const stats = await request(server).get('/telemetry/api/stats');
    expect(stats.body.data.MAIL).toBe(1);
  });

  it('is recorded the same way when the module is registered with forRootAsync', async () => {
    const mailApp = await createMailApp({}, true);
    current = mailApp.app;

    await request(mailApp.server).post('/mail/token').expect(201);

    const storage = mailApp.storage;
    expect(await eventually(() => mailEntries(storage), (list) => list.length === 1)).toHaveLength(1);
  });

  it('is recorded through a MailerService provider, once, with the rendered template', async () => {
    current = await createAppWith([TelemetryModule.forRoot()], [{ provide: MailerService, useFactory: () => new MailerService() }]);

    await current.get(MailerService).sendMail({ to: 'ana@x.test', subject: 'Envío', template: 'order-shipped', context: { name: 'Ana', order: 3 } });

    const entries = await mailEntries(current.get(TELEMETRY_STORAGE));
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toMatchObject({ source: 'mailer', template: 'order-shipped', transport: 'JSONTransport' });
    expect(entries[0].content.bodyPreview).toBe('Hola Ana\nTu pedido 3 salió.');
  });

  it('looks inside a host class that only happens to be called MailerService', async () => {
    @Injectable()
    class HostMailerService {
      private readonly transporter = jsonTransport();
      sendMail(to: string, subject: string, html: string) {
        return this.transporter.sendMail({ from: 'host@app.test', to, subject, html });
      }
    }
    Object.defineProperty(HostMailerService, 'name', { value: 'MailerService' });
    current = await createAppWith([TelemetryModule.forRoot()], [HostMailerService]);

    const service = current.get(HostMailerService);
    await service.sendMail('ana@x.test', 'Hola', '<p>Hola</p>');

    expect(hasOwnSendMail(service)).toBe(false);
    const entries = await mailEntries(current.get(TELEMETRY_STORAGE));
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toMatchObject({ subject: 'Hola', to: 'ana@x.test', source: 'nodemailer' });
  });

  it('finds a transporter another module creates in its onModuleInit', async () => {
    @Injectable()
    class LateEmailService implements OnModuleInit {
      transporter?: nodemailer.Transporter;
      onModuleInit() {
        this.transporter = jsonTransport();
      }
    }
    @Module({ providers: [LateEmailService], exports: [LateEmailService] })
    class LateEmailModule {}
    current = await createAppWith([TelemetryModule.forRoot(), LateEmailModule]);

    await current.get(LateEmailService).transporter!.sendMail({ to: 'ana@x.test', subject: 'Late' });

    expect(await mailEntries(current.get(TELEMETRY_STORAGE))).toHaveLength(1);
  });

  it('leaves a spy set up before init a spy, and still records the mail', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelemetryModule.forRoot()],
      providers: [{ provide: MAIL_TRANSPORTER, useFactory: () => jsonTransport() }],
    }).compile();
    const transporter = moduleRef.get(MAIL_TRANSPORTER);
    const spy = jest.spyOn(transporter, 'sendMail');
    current = moduleRef.createNestApplication({ logger: false });
    await current.init();

    await transporter.sendMail({ to: 'ana@x.test', subject: 'Spied' });

    expect(transporter.sendMail).toBe(spy);
    expect(spy).toHaveBeenCalledWith({ to: 'ana@x.test', subject: 'Spied' });
    expect(await mailEntries(current.get(TELEMETRY_STORAGE))).toHaveLength(1);
  });

  it('is left alone when watchers.mail is false', async () => {
    const mailApp = await createMailApp({ watchers: { mail: false } });
    current = mailApp.app;

    expect(hasOwnSendMail(mailApp.transporter)).toBe(false);
    await request(mailApp.server).post('/mail/token').expect(201);
    await sleep(50);
    expect(await mailEntries(mailApp.storage)).toHaveLength(0);
  });

  it('keeps the default when watchers.mail is explicitly undefined', async () => {
    const mailApp = await createMailApp({ watchers: { mail: undefined } });
    current = mailApp.app;

    expect(hasOwnSendMail(mailApp.transporter)).toBe(true);
  });

  it('gets its original methods back when the application closes', async () => {
    const mailApp = await createMailApp();
    const transport = (mailApp.transporter as any).transporter;
    expect(hasOwnSendMail(mailApp.transporter)).toBe(true);

    await mailApp.app.close();

    expect(hasOwnSendMail(mailApp.transporter)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(transport, 'send')).toBe(false);
  });
});
