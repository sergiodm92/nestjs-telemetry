import { TelemetryMailWatcher, htmlToText } from '../src/watchers/mail.watcher';
import { InMemoryTelemetryStorage } from '../src/storage/in-memory.storage';
import { TelemetryEntryType } from '../src/model/telemetry-entry-type';
import { TelemetryContext } from '../src/context/telemetry-context';
import { SAMPLE_JWT } from './support/test-app';

describe('TelemetryMailWatcher', () => {
  let storage: InMemoryTelemetryStorage;
  let watcher: TelemetryMailWatcher;

  const mails = async () => storage.getByType(TelemetryEntryType.MAIL, {}, 0, 10);

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    watcher = new TelemetryMailWatcher(storage);
  });

  it('records sent mail with to, from, subject', async () => {
    await watcher.record({
      to: 'user@example.com',
      from: 'noreply@app.com',
      subject: 'Welcome!',
      body: 'Hello there',
      type: 'text',
    });

    const entries = await mails();
    expect(entries).toHaveLength(1);
    expect(entries[0].content.to).toBe('user@example.com');
    expect(entries[0].content.from).toBe('noreply@app.com');
    expect(entries[0].content.subject).toBe('Welcome!');
    expect(entries[0].content.bodyPreview).toBe('Hello there');
    expect(entries[0].content.status).toBe('sent');
  });

  it('truncates long body preview', async () => {
    await watcher.record({
      to: 'a@b.com',
      from: 'c@d.com',
      subject: 'Test',
      body: 'x'.repeat(1000),
      type: 'text',
    });

    const entries = await mails();
    expect(entries[0].content.bodyPreview.length).toBeLessThanOrEqual(550);
  });

  it('tags with mail and recipient', async () => {
    await watcher.record({
      to: 'dev@test.com',
      from: 'noreply@test.com',
      subject: 'Hi',
      body: '',
      type: 'html',
    });

    const entries = await mails();
    expect(entries[0].tags).toContain('mail');
    expect(entries[0].tags).toContain('to:dev@test.com');
  });

  describe('takes nodemailer sendMail() options as they are', () => {
    const template = `<!DOCTYPE html><html><head><title>t</title><style>p { color: red }</style></head>
      <body><h1>Hola Ana</h1><p>Tu c&oacute;digo es <b>123456</b>&nbsp;&amp; vence pronto.</p>
      <script>alert(1)</script><!-- a comment --><p>Equipo&#33;</p></body></html>`;

    it('reads html with no body, and previews the text a reader sees', async () => {
      await watcher.record({ from: 'app@x.test', to: 'ana@x.test', subject: 'Código', html: template });

      const [entry] = await mails();
      expect(entry.content.type).toBe('html');
      expect(entry.content.bodyPreview).toBe('Hola Ana\nTu código es 123456 & vence pronto.\nEquipo!');
      expect(entry.content.html).toBe(template);
    });

    it('keeps text and html apart when both are given', async () => {
      await watcher.record({ to: 'a@x.test', html: '<p>rich</p>', text: 'plain version' });

      const [entry] = await mails();
      expect(entry.content.type).toBe('html');
      expect(entry.content.text).toBe('plain version');
      expect(entry.content.bodyPreview).toBe('plain version');
      expect(entry.content.html).toBe('<p>rich</p>');
    });

    it('formats every address shape nodemailer accepts and tags each recipient', async () => {
      await watcher.record({
        from: { name: 'OrderNow', address: 'noreply@x.test' },
        to: [{ name: 'Ana', address: 'ana@x.test' }, 'bob@x.test', 'Carla <carla@x.test>'],
        cc: 'dan@x.test, eve@x.test',
        bcc: [{ address: 'audit@x.test' }],
        subject: 'Hi',
        text: 'hello',
      });

      const [entry] = await mails();
      expect(entry.content.from).toBe('OrderNow <noreply@x.test>');
      expect(entry.content.to).toBe('Ana <ana@x.test>, bob@x.test, Carla <carla@x.test>');
      expect(entry.content.cc).toBe('dan@x.test, eve@x.test');
      expect(entry.content.bcc).toBe('audit@x.test');
      expect(entry.tags).toEqual(['mail', 'to:ana@x.test', 'to:bob@x.test', 'to:carla@x.test']);
    });

    it('reads a Buffer body and does not read a file, URL or stream', async () => {
      await watcher.record({ to: 'a@x.test', html: Buffer.from('<p>from a buffer</p>') });
      await watcher.record({ to: 'b@x.test', html: { path: '/templates/welcome.html' } });

      const [fromFile, fromBuffer] = await mails();
      expect(fromBuffer.content.bodyPreview).toBe('from a buffer');
      expect(fromFile.content.html).toMatch(/not recorded/);
    });

    it('describes attachments without keeping their content', async () => {
      await watcher.record({
        to: 'a@x.test',
        text: 'see attached',
        attachments: [
          { filename: 'invoice.pdf', content: Buffer.alloc(2048), contentType: 'application/pdf' },
          { path: '/var/files/report.csv' },
          { filename: 'note.txt', content: 'aGVsbG8=', encoding: 'base64' },
        ],
      });

      const [entry] = await mails();
      expect(entry.content.attachments).toEqual([
        { filename: 'invoice.pdf', contentType: 'application/pdf', size: 2048 },
        { filename: 'report.csv', contentType: '' },
        { filename: 'note.txt', contentType: '', size: 5 },
      ]);
    });
  });

  describe('masking', () => {
    it('masks the token of a link and a JWT anywhere in the body', async () => {
      const html =
        `<a href="https://app.test/reset?user=7&amp;token=RESET-SECRET">Reset</a>` +
        `<p>https://app.test/verify?code=424242#access_token=FRAG-SECRET</p><p>${SAMPLE_JWT}</p>`;
      await watcher.record({ to: 'a@x.test', subject: `Login ${SAMPLE_JWT}`, html, text: `go to https://app.test/r?apikey=K-SECRET` });

      const [entry] = await mails();
      const stored = JSON.stringify(entry.content);
      for (const secret of ['RESET-SECRET', '424242', 'FRAG-SECRET', 'K-SECRET', SAMPLE_JWT]) {
        expect(stored).not.toContain(secret);
      }
      expect(entry.content.html).toContain('https://app.test/reset?user=7&amp;token=***');
      expect(entry.content.subject).toBe('Login ***');
    });

    it('masks before truncating, so a token cut in half never shows', async () => {
      const html = `<p>${'x'.repeat(49_990)}</p><a href="https://app.test/r?token=TAIL-SECRET">r</a>`;
      await watcher.record({ to: 'a@x.test', html });

      const [entry] = await mails();
      expect(entry.content.htmlTruncated).toBe(true);
      expect(entry.content.html.length).toBeLessThanOrEqual(50_000 + '... [truncated]'.length);
      expect(JSON.stringify(entry.content)).not.toContain('TAIL-SECRET');
    });
  });

  describe('never breaks the caller', () => {
    it('records what it can from odd input instead of throwing', async () => {
      await expect(watcher.record(undefined as any)).resolves.toBeUndefined();
      await expect(watcher.record({ to: 42 as any, subject: 7 as any, html: 3 as any })).resolves.toBeUndefined();

      const entries = await mails();
      expect(entries).toHaveLength(2);
      expect(entries[0].content.to).toBe('42');
    });

    it('swallows a storage failure', async () => {
      jest.spyOn((watcher as any).logger, 'warn').mockImplementation(() => undefined);
      jest.spyOn(storage, 'store').mockRejectedValueOnce(new Error('disk full'));
      await expect(watcher.record({ to: 'a@x.test', text: 'hi' })).resolves.toBeUndefined();
    });
  });

  it('records nothing when watchers.mail is off, or recording is paused', async () => {
    const off = new TelemetryMailWatcher(storage, false);
    await off.record({ to: 'a@x.test', text: 'hi' });
    storage.setEnabled(false);
    await watcher.record({ to: 'b@x.test', text: 'hi' });
    storage.setEnabled(true);

    expect(await mails()).toHaveLength(0);
  });

  it('records a failure the caller reports, and tags it', async () => {
    await watcher.record({ to: 'a@x.test', subject: 'x', status: 'failed', error: 'Mailbox unavailable' });

    const [entry] = await mails();
    expect(entry.content.status).toBe('failed');
    expect(entry.content.error).toBe('Mailbox unavailable');
    expect(entry.tags).toContain('mail:failed');
  });

  it('joins the batch of the request it was sent from', async () => {
    await TelemetryContext.run({ batchId: 'batch-1', userIdentifier: 'ana', tenantId: 't1' }, () =>
      watcher.record({ to: 'a@x.test', text: 'hi' }),
    );

    const [entry] = await mails();
    expect(entry.batchId).toBe('batch-1');
    expect(entry.userIdentifier).toBe('ana');
    expect(entry.tenantId).toBe('t1');
  });
});

describe('TelemetryMailWatcher on hostile or awkward input', () => {
  let storage: InMemoryTelemetryStorage;
  let watcher: TelemetryMailWatcher;

  beforeEach(() => {
    storage = new InMemoryTelemetryStorage(100);
    watcher = new TelemetryMailWatcher(storage);
  });

  const timed = async (run: () => Promise<unknown>) => {
    const started = Date.now();
    await run();
    return Date.now() - started;
  };

  it('stays fast on a huge recipient with no @, a huge subject and a body of JWT lookalikes', async () => {
    expect(await timed(() => watcher.record({ to: 'a'.repeat(50_000), subject: 'eyJ'.repeat(40_000) }))).toBeLessThan(500);
    expect(await timed(() => watcher.record({ to: 'a@x.test', text: 'eyJ'.repeat(300_000) }))).toBeLessThan(1000);
    expect(await timed(() => watcher.record({ to: 'a@x.test', html: `<p>${'eyJ'.repeat(300_000)}</p>` }))).toBeLessThan(1000);

    const [body, , header] = await storage.getByType(TelemetryEntryType.MAIL, {}, 0, 10);
    expect(header.content.subject.length).toBeLessThanOrEqual(2_000 + '... [truncated]'.length);
    expect(body.content.htmlTruncated).toBe(true);
  });

  it('keeps the query string of an attachment URL out of its name', async () => {
    await watcher.record({
      to: 'a@x.test',
      attachments: [
        { path: 'https://files.test/invoices/inv-42.pdf?token=DOWNLOAD-SECRET' },
        { href: 'https://bucket.s3.test/report.csv?X-Amz-Credential=AKIA&X-Amz-Security-Token=SESSION-SECRET' },
      ],
    });

    const [entry] = await storage.getByType(TelemetryEntryType.MAIL, {}, 0, 1);
    expect(entry.content.attachments.map((a: { filename: string }) => a.filename)).toEqual(['inv-42.pdf', 'report.csv']);
    expect(JSON.stringify(entry.content)).not.toMatch(/SECRET|AKIA/);
  });

  it('masks a link carried inside the query string of another link', async () => {
    const html =
      '<a href="https://app.test/login?next=https%3A%2F%2Fapp.test%2Freset%3Ftoken%3DNESTED-SECRET&amp;lang=es">Entrar</a>' +
      '<a href="https://app.test/go?redirect=/accept?token=PLAIN-SECRET">Aceptar</a>';
    await watcher.record({ to: 'a@x.test', html });

    const [entry] = await storage.getByType(TelemetryEntryType.MAIL, {}, 0, 1);
    expect(entry.content.html).not.toMatch(/NESTED-SECRET|PLAIN-SECRET/);
    expect(entry.content.html).toContain('lang=es');
  });

  it('leaves the style around a masked url() intact', async () => {
    await watcher.record({ to: 'a@x.test', html: '<div style="background:url(https://cdn.test/bg.png?token=abc);color:red">x</div>' });

    const [entry] = await storage.getByType(TelemetryEntryType.MAIL, {}, 0, 1);
    expect(entry.content.html).toBe('<div style="background:url(https://cdn.test/bg.png?token=***);color:red">x</div>');
  });
});

describe('htmlToText', () => {
  it('keeps every character in place when lower-casing would change the length (İ)', () => {
    expect(htmlToText('<p>İstanbul İzmir</p><style>p { color: red }</style><p>ok</p>')).toBe('İstanbul İzmir\nok');
  });

  it('reads the body of a document whose <head> is never closed, as HTML allows', () => {
    expect(htmlToText('<html><head><meta charset="utf-8"><title>T</title><body><p>Body text</p>')).toBe('Body text');
  });

  it('does not end a tag at a > inside a quoted attribute', () => {
    expect(htmlToText('<a title="a > b" href="https://x.test">Link</a> after')).toBe('Link after');
  });

  it('stays linear on hostile markup', () => {
    const hostile = '<style'.repeat(20_000) + '<'.repeat(20_000) + '<!--'.repeat(20_000);
    const started = Date.now();
    htmlToText(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('keeps a lone < that opens no tag', () => {
    expect(htmlToText('1 < 2 and 3 > 2')).toBe('1 < 2 and 3 > 2');
  });
});
