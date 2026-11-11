---
title: Mail
description: How sent mail is captured with no code in your app, what a MAIL entry holds, how the dashboard shows it, and how to record senders the module cannot find.
---

Mail is captured automatically. When the application starts, the module looks for the mail senders it knows among your providers and records every message they send, or fail to send. You do not call anything.

## Which senders are found

| Sender | Found when |
| --- | --- |
| A nodemailer transporter (`nodemailer.createTransport(...)`, nodemailer 6 or later) | It is a provider itself, or a field of a provider or controller (directly, or as a value of a `Map` field). |
| The `MailerService` of `@nestjs-modules/mailer` | It is a provider. Its transporters are instrumented, including the ones `addTransporter()` adds later. |

The search runs once, in `onApplicationBootstrap`: after every module's `onModuleInit`, so a transporter created there is found. Both usual wirings work as they are:

```ts title="A transporter that is a provider"
@Module({
  providers: [
    {
      provide: 'MAIL_TRANSPORTER',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        nodemailer.createTransport({ host: config.get('MAIL_HOST'), port: 587, auth: { user: config.get('MAIL_USER'), pass: config.get('MAIL_PASS') } }),
    },
    EmailService,
  ],
})
export class EmailsModule {}
```

```ts title="A transporter kept in a field"
@Injectable()
export class EmailService {
  private readonly transporter = nodemailer.createTransport({ host: 'smtp.example.com', port: 587 });

  sendWelcome(to: string) {
    return this.transporter.sendMail({ from: 'noreply@example.com', to, subject: 'Welcome', html: '<h1>Hi</h1>' });
  }
}
```

Not found: a transporter created later (inside a method, or on first use), one kept deeper than one property, one in a `#private` field, or one owned by a request-scoped provider. For those, see [Senders the module cannot see](#senders-the-module-cannot-see).

## What is recorded

The message is recorded where nodemailer hands it to its transport, so the entry shows what was really sent: a template already rendered into HTML, the transporter's defaults (such as `from`) applied, the recipients after any interception.

| Field | Content |
| --- | --- |
| `to`, `from`, `cc`, `bcc`, `replyTo` | Addresses as one line: `Ana <ana@example.com>, bob@example.com`. Empty ones are left out. |
| `subject` | The subject. |
| `type` | `html` or `text`. |
| `bodyPreview` | The text a reader sees, without markup, styles or scripts: the first 500 characters. |
| `html` | The HTML, up to 50 KB; `htmlTruncated: true` when it was longer. |
| `text` | The plain-text body, up to 10,000 characters. |
| `template` | The template name, for `@nestjs-modules/mailer`. |
| `attachments` | `{ filename, contentType, size }` per attachment (20 at most). Their content is never stored. |
| `status` | `sent` or `failed`. |
| `error` | Why it failed. |
| `duration` | Milliseconds from `sendMail()` to the transport's answer. |
| `messageId` | The `Message-ID`. |
| `accepted`, `rejected` | The recipients the transport reported. |
| `transport` | `SMTP`, `SMTP (pool)`, `SESTransport`, `JSONTransport`... |
| `source` | `nodemailer`, `mailer` or `manual`. |

Tags: `mail`, one `to:<address>` per recipient, and `mail:failed` for a failure.

A mail sent while handling a request carries that request's batch ID, user and tenant, even when the transport answers later from a pooled connection opened by another request.

### Failures

Two kinds of failure are recorded, both with `status: 'failed'` and the error message:

- the transport refused or could not deliver (authentication, connection, rejected recipients);
- the message failed before reaching the transport (a template that does not exist, an invalid address). The entry is then built from the options passed to `sendMail()`.

Your code receives exactly the same result or error as without telemetry.

## In the dashboard

The **Mail** view lists subject and recipients, with a **FAILED** badge on failures. The detail panel shows the status, duration and transport, the error, every address, the message id, rejected recipients, attachments, the HTML rendered in a sandboxed frame, and the text preview.

The frame runs no script, submits no form and cannot navigate the dashboard. Remote images and fonts are blocked, so opening a mail fires no tracking pixel; **Load them** lifts the block for that mail.

## Masking

Mail bodies have no field names, so they are masked by what can be recognised: every JWT by its shape, and the query string and fragment of every link, `href` attributes included, the way a request's query string is (`https://app/reset?token=...` keeps the address and loses the token). A link carried inside another link's query string is masked too.

A code written in the text itself ("your code is 123456") is not masked, and neither are addresses. See [Data masking](../concepts/data-masking.md).

## Senders the module cannot see

Inject `TelemetryMailWatcher` (the module exports it).

**A nodemailer-style sender created later**: hand it to `instrument()`, which returns it.

```ts
const transporter = this.mailWatcher.instrument(nodemailer.createTransport(smtpOptions));
await transporter.sendMail({ from, to, subject, html });
```

`instrument()` accepts a nodemailer transporter, a `MailerService`, or any object with nodemailer's `sendMail(options, callback?)` contract. Calling it twice changes nothing, and a jest mock passed to it is left untouched.

**An HTTP API client** (Resend, SendGrid, the AWS SDK): call `record()` once the send settled.

```ts title="src/mail/resend-mail.service.ts"
import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { TelemetryMailWatcher } from '@nestjs-telemetry/core';

@Injectable()
export class ResendMailService {
  private readonly resend = new Resend(process.env.RESEND_API_KEY);

  constructor(private readonly mailWatcher: TelemetryMailWatcher) {}

  async send(to: string, subject: string, html: string): Promise<void> {
    const from = 'Acme <noreply@example.com>';
    const started = Date.now();
    const { data, error } = await this.resend.emails.send({ from, to, subject, html });
    await this.mailWatcher.record({
      from, to, subject, html,
      status: error ? 'failed' : 'sent',
      error: error?.message,
      messageId: data?.id,
      duration: Date.now() - started,
      transport: 'Resend',
    });
    if (error) throw new Error(error.message);
  }
}
```

`record()` takes a `MailInfo`: every field is optional, addresses may be strings, `{ name, address }` objects or arrays, and the body can be given as `html`, `text` or `body` (with `type`). It never throws.

## In tests

A `jest.spyOn(transporter, 'sendMail')` or a `jest.fn()` stays what it is, so your assertions keep working; a spied transporter's sends are still recorded at its transport. Two applications created in the same process that share a transporter each record their own mail while they are open, and the original methods are put back when the last one closes.

## Turning it off

`watchers: { mail: false }` skips the search, and `record()` and `instrument()` do nothing.

## The Mail view is empty?

1. **Is the sender found?** It must be a provider, or a field of one, when the app starts. A transporter created on first use needs `instrument()`; an API client needs `record()`.
2. **Did the application send anything?** Code that skips sending outside production (returning a development code instead of mailing it, say) leaves nothing to record, which is common exactly where the dashboard runs.
3. **Is recording paused?** Check the **Enabled** button.
4. **Is `watchers.mail` false?**
5. **Which version?** Up to 0.2.3, mail was recorded only by explicit `record()` calls.
