import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntry } from '../model/telemetry-entry';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TelemetryContext, TelemetryStore } from '../context/telemetry-context';
import { redactText } from './request.interceptor';

const MAX_BODY_PREVIEW = 500;
const MAX_TEXT_LENGTH = 10_000;
const MAX_HTML_LENGTH = 50_000;
// Read at most this much of a body: masking and the text preview never walk a huge document, and
// what is kept is far shorter anyway.
const MAX_READ_LENGTH = 1_000_000;
// Addresses and the subject of a real mail are short; anything longer is cut before it is looked at.
const MAX_HEADER_LENGTH = 2_000;
const MAX_ADDRESSES = 100;
const MAX_ERROR_LENGTH = 2_000;
// Attachments described and recipients tagged, per mail.
const MAX_LISTED = 20;
const MAX_TRANSPORTERS = 50;
const TRUNCATED = '... [truncated]';
const NOT_READ = '[not recorded: given as a file, URL or stream]';

/** An address as nodemailer takes one: `'ana@example.com'`, `'Ana <ana@example.com>'` or `{ name, address }`. */
export type MailAddress = string | { name?: string; address?: string };

/** One address or several. A string may itself be a comma separated list. */
export type MailAddresses = MailAddress | MailAddress[];

/**
 * A mail that was sent, or that failed to send. Every field is optional, so nodemailer's
 * `sendMail()` options can be handed over as they are: `html` and `text` are read like `body`, and
 * an address may be a string, an object or an array of either.
 */
export interface MailInfo {
  to?: MailAddresses;
  from?: MailAddresses;
  cc?: MailAddresses;
  bcc?: MailAddresses;
  replyTo?: MailAddresses;
  subject?: string;
  /** The body as one string, `type` says which kind it is. */
  body?: string;
  /** HTML body. A Buffer is read as UTF-8; a file, a URL or a stream is not read. */
  html?: unknown;
  /** Plain text body, read like `html`. */
  text?: unknown;
  /** `'html'` or `'text'`. Worked out from `html`, `text` or `body` when omitted. */
  type?: string;
  /** Template name, for mailers that render one (`@nestjs-modules/mailer`). */
  template?: string;
  attachments?: unknown[];
  /** `'sent'` (the default) or `'failed'`. */
  status?: 'sent' | 'failed';
  /** Why the send failed. */
  error?: string;
  /** How long the send took, in milliseconds. */
  duration?: number;
  messageId?: string;
  accepted?: unknown[];
  rejected?: unknown[];
  /** Name of the nodemailer transport that sent it: `SMTP`, `JSONTransport`... */
  transport?: string;
  /** What recorded it: `'nodemailer'`, `'mailer'` (`@nestjs-modules/mailer`) or `'manual'`. */
  source?: string;
}

/** The kinds of mail sender the module instruments by itself. */
export type MailSource = 'nodemailer' | 'mailer';

// ── inspecting objects without disturbing them ──────────────────────────

/**
 * A property's value, read through descriptors up the prototype chain: no getter runs, and an
 * auto-mocking proxy (jest-mock-extended) is not made to grow the property by being asked for it.
 */
function peek(target: unknown, key: string): unknown {
  let current: unknown = target;
  for (let depth = 0; current && depth < 16; depth++) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A jest mock function or mock object: the test that made it asserts on it, so it is left alone. */
function isMock(value: unknown): boolean {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  return peek(value, '_isMockFunction') === true || peek(value, '_isMockObject') === true;
}

/**
 * What kind of mail sender `value` is, if it is one this package knows how to instrument:
 * - `'nodemailer'`: a transporter made by nodemailer's `createTransport()` (any major since 6): a
 *   `sendMail()` and a `use()`, and the transport it wraps under `transporter`, with its `send()`.
 * - `'mailer'`: the `MailerService` of `@nestjs-modules/mailer`, which keeps its nodemailer
 *   transporters under `transporter` and in a `transporters` Map.
 * Anything else, a class of the host's own with a `sendMail()` method included, is left alone:
 * its arguments could mean anything.
 */
export function mailSourceOf(value: unknown): MailSource | undefined {
  if (!value || typeof value !== 'object' || isMock(value)) return undefined;
  if (typeof peek(value, 'sendMail') !== 'function') return undefined;
  const transport = peek(value, 'transporter');
  if (
    typeof peek(value, 'use') === 'function' &&
    transport &&
    typeof transport === 'object' &&
    typeof peek(transport, 'send') === 'function'
  ) {
    return 'nodemailer';
  }
  const constructor = peek(value, 'constructor');
  if (
    typeof constructor === 'function' &&
    constructor.name === 'MailerService' &&
    peek(value, 'transporters') instanceof Map
  ) {
    return 'mailer';
  }
  return undefined;
}

// ── patching ─────────────────────────────────────────────────────────────

type AnyFunction = (...args: any[]) => any;

/**
 * One method replaced on one object. Several watchers (several applications in one process, as in
 * a test suite) can share it: the newest one that is still alive records, and once none is left
 * the original method is put back, or, if something else replaced the method since, the wrapper
 * simply passes every call through.
 */
interface MethodPatch {
  target: object;
  name: string;
  original: AnyFunction;
  wrapper: AnyFunction;
  own: PropertyDescriptor | undefined;
  owners: TelemetryMailWatcher[];
}

const patches = new WeakMap<object, Map<string, MethodPatch>>();
// A wrapper that outlived its patch (put back by a spy's mockRestore(), say) is unwrapped, never
// wrapped again.
const originals = new WeakMap<AnyFunction, AnyFunction>();

function ownerOf(patch: MethodPatch): TelemetryMailWatcher | undefined {
  const owner = patch.owners[patch.owners.length - 1];
  return owner && owner.isRecording() ? owner : undefined;
}

function uninstall(patch: MethodPatch): void {
  const byName = patches.get(patch.target);
  // Only this patch's own registration: the method may have been patched afresh since.
  if (byName?.get(patch.name) === patch) byName.delete(patch.name);
  try {
    const current = Object.getOwnPropertyDescriptor(patch.target, patch.name);
    if (!current || current.value !== patch.wrapper) return; // replaced since: leave it alone
    if (patch.own) Object.defineProperty(patch.target, patch.name, patch.own);
    else delete (patch.target as Record<string, unknown>)[patch.name];
  } catch {
    // Frozen since: the wrapper stays, and passes calls through.
  }
}

/** One `sendMail()` call in progress, seen by the transport it reaches. */
interface SendCall {
  target: object;
  source: string;
  owner: TelemetryMailWatcher;
  store: TelemetryStore | undefined;
  startedAt: number;
  options: Record<string, any>;
  /** The transport recorded the message itself. */
  transported: boolean;
  /** An instrumented sendMail() it called recorded it. */
  delegated: boolean;
  settled: boolean;
}

const calls = new AsyncLocalStorage<SendCall>();

const OPTION_FIELDS = [
  'to', 'from', 'cc', 'bcc', 'replyTo', 'subject', 'html', 'text', 'template', 'attachments',
] as const;

/** The fields a mail is recorded with, copied when the send starts: reusing the options object later changes nothing. */
function snapshot(options: unknown): Record<string, any> {
  const copy: Record<string, any> = {};
  if (!options || typeof options !== 'object') return copy;
  for (const field of OPTION_FIELDS) {
    const value = peek(options, field);
    if (value !== undefined) copy[field] = Array.isArray(value) ? value.slice(0, MAX_ADDRESSES) : value;
  }
  return copy;
}

function sendMailWrapper(patch: MethodPatch, source: string, nodemailer: boolean): AnyFunction {
  return function (this: unknown, ...args: any[]): any {
    const owner = ownerOf(patch);
    if (!owner) return patch.original.apply(this, args);

    const parent = calls.getStore();
    if (parent && !parent.settled && parent.target !== patch.target) parent.delegated = true;
    const options = snapshot(args[0]);
    if (nodemailer) {
      // What the transport would have seen: nodemailer applies the transporter's defaults.
      const defaults = peek(patch.target, '_defaults');
      if (defaults && typeof defaults === 'object') {
        for (const [key, value] of Object.entries(snapshot(defaults))) options[key] ??= value;
      }
    }
    const call: SendCall = {
      target: patch.target,
      source,
      owner,
      store: TelemetryContext.getStore(),
      startedAt: Date.now(),
      options,
      transported: false,
      delegated: false,
      settled: false,
    };
    const finish = (failed: boolean, error: unknown, info?: unknown): void => {
      if (call.settled) return;
      call.settled = true;
      if (!call.transported && !call.delegated) owner.recordCall(call, failed, error, info);
    };

    if (typeof args[1] === 'function') {
      const callback = args[1] as AnyFunction;
      const relay = (error: unknown, ...results: unknown[]) => {
        finish(error !== null && error !== undefined, error, results[0]);
        return callback(error, ...results);
      };
      try {
        return calls.run(call, () => patch.original.call(this, args[0], relay, ...args.slice(2)));
      } catch (error) {
        finish(true, error);
        throw error;
      }
    }

    let result: any;
    try {
      result = calls.run(call, () => patch.original.apply(this, args));
    } catch (error) {
      finish(true, error);
      throw error;
    }
    if (result && typeof result.then === 'function') {
      return result.then(
        (info: unknown) => {
          finish(false, undefined, info);
          return info;
        },
        (error: unknown) => {
          finish(true, error);
          throw error;
        },
      );
    }
    finish(false, undefined, result);
    return result;
  };
}

/**
 * nodemailer hands every message to its transport's `send(mail, callback)` once the compile and
 * stream plugins ran, so `mail.data` is what is really sent: a template already rendered into
 * `html`, the transporter's defaults applied, the recipients after any interception.
 */
function transportSendWrapper(patch: MethodPatch, mailer: object, source: string): AnyFunction {
  return function (this: unknown, mail: any, callback: any, ...rest: any[]): any {
    const owner = ownerOf(patch);
    if (!owner || typeof callback !== 'function') return patch.original.call(this, mail, callback, ...rest);

    const active = calls.getStore();
    const call = active && !active.settled && active.target === mailer ? active : undefined;
    if (call) call.transported = true;
    const recorder = call?.owner ?? owner;
    const sent = {
      data: snapshot(peek(mail, 'data')),
      message: peek(mail, 'message'),
      store: call ? call.store : TelemetryContext.getStore(),
      startedAt: call ? call.startedAt : Date.now(),
      source: call?.source ?? source,
      transport: typeof peek(this, 'name') === 'string' ? (peek(this, 'name') as string) : undefined,
    };
    const relay = (error: unknown, info: unknown, ...more: unknown[]) => {
      recorder.recordMessage(sent, error !== null && error !== undefined, error, info);
      return callback(error, info, ...more);
    };
    try {
      return patch.original.call(this, mail, relay, ...rest);
    } catch (error) {
      recorder.recordMessage(sent, true, error, undefined);
      throw error;
    }
  };
}

@Injectable()
export class TelemetryMailWatcher implements OnModuleDestroy {
  private readonly logger = new Logger(TelemetryMailWatcher.name);
  // Weak: a transporter created per call and instrumented by hand must stay collectable.
  private owned: WeakRef<MethodPatch>[] = [];

  /**
   * @param enabled `watchers.mail`. When false nothing is recorded or instrumented: neither what
   *   `record()` is handed, nor anything passed to `instrument()`.
   */
  constructor(
    private readonly storage: TelemetryStorage,
    private readonly enabled = true,
  ) {}

  /** Whether a mail would be recorded right now (`watchers.mail` on, recording not paused). */
  isRecording(): boolean {
    return this.enabled && this.storage.isEnabled();
  }

  /**
   * Records a mail. Use it for a provider this package does not instrument (an HTTP API client
   * such as Resend's or SES's): call it once the send settled, with `status: 'failed'` and `error`
   * when it did not go out. Never throws; a mail that cannot be recorded is skipped.
   */
  async record(mail: MailInfo): Promise<void> {
    if (!this.isRecording()) return;
    try {
      // Built before the first await, so the batch is read in the caller's context.
      const entry = this.toEntry(mail ?? {}, TelemetryContext.getStore());
      await this.storage.store(entry);
    } catch (err) {
      this.logger.warn(`Could not record a mail: ${errorMessage(err)}`);
    }
  }

  /**
   * Records every mail sent through `target` from now on:
   * - a nodemailer transporter: what its transport really sends (templates rendered, defaults
   *   applied), and the sends that fail before they reach it;
   * - a `MailerService` of `@nestjs-modules/mailer`: through its nodemailer transporters, including
   *   the ones `addTransporter()` adds later;
   * - anything else with nodemailer's `sendMail(options, callback?)` contract: what it is called with.
   * The module already does this for the senders it finds among the providers; call it for one it
   * cannot see, such as a transporter created inside a method. The send itself is untouched: same
   * arguments, same result, same error. Calling it again changes nothing. A jest mock is never
   * wrapped. Returns `target`.
   */
  instrument<T extends object>(target: T, source?: string): T {
    if (!this.enabled || !target || typeof target !== 'object') return target;
    try {
      const kind = mailSourceOf(target);
      if (kind === 'nodemailer') this.instrumentNodemailer(target, source ?? 'nodemailer');
      else if (kind === 'mailer') this.instrumentMailerService(target, source ?? 'mailer');
      else if (typeof peek(target, 'sendMail') === 'function') {
        const label = source ?? 'manual';
        this.patch(target, 'sendMail', (patch) => sendMailWrapper(patch, label, false));
      }
    } catch (err) {
      this.logger.warn(`Cannot record the mail sent through ${describe(target)}: ${errorMessage(err)}`);
    }
    return target;
  }

  /** Puts back every method this watcher replaced, unless another watcher still uses it. Runs when the module is destroyed. */
  restore(): void {
    for (const reference of this.owned.splice(0).reverse()) {
      const patch = reference.deref();
      if (!patch) continue;
      const index = patch.owners.lastIndexOf(this);
      if (index !== -1) patch.owners.splice(index, 1);
      if (patch.owners.length === 0) uninstall(patch);
    }
  }

  onModuleDestroy(): void {
    this.restore();
  }

  /** @internal Records a sendMail() call that no transport recorded (it failed before, or nothing else was wrapped). */
  recordCall(call: SendCall, failed: boolean, error: unknown, info: unknown): void {
    const result = asRecord(info);
    const envelope = asRecord(result.envelope);
    const options = call.options;
    this.recordWith(
      {
        to: options.to ?? envelope.to,
        from: options.from ?? envelope.from,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
        subject: options.subject,
        html: options.html,
        text: options.text,
        template: typeof options.template === 'string' ? options.template : undefined,
        attachments: Array.isArray(options.attachments) ? options.attachments : undefined,
        status: failed ? 'failed' : 'sent',
        error: failed ? errorMessage(error) : undefined,
        duration: Date.now() - call.startedAt,
        messageId: typeof result.messageId === 'string' ? result.messageId : undefined,
        accepted: Array.isArray(result.accepted) ? result.accepted : undefined,
        rejected: Array.isArray(result.rejected) ? result.rejected : undefined,
        transport: transportName(call.target),
        source: call.source,
      },
      call.store,
    );
  }

  /** @internal Records a message a nodemailer transport was handed. */
  recordMessage(
    sent: { data: Record<string, any>; message: unknown; store: TelemetryStore | undefined; startedAt: number; source: string; transport?: string },
    failed: boolean,
    error: unknown,
    info: unknown,
  ): void {
    const result = asRecord(info);
    let messageId = typeof result.messageId === 'string' ? result.messageId : undefined;
    if (!messageId) {
      try {
        const read = peek(sent.message, 'messageId');
        if (typeof read === 'function') messageId = String(read.call(sent.message));
      } catch {
        // No id to show.
      }
    }
    const data = sent.data;
    this.recordWith(
      {
        to: data.to,
        from: data.from,
        cc: data.cc,
        bcc: data.bcc,
        replyTo: data.replyTo,
        subject: data.subject,
        html: data.html,
        text: data.text,
        template: typeof data.template === 'string' ? data.template : undefined,
        attachments: Array.isArray(data.attachments) ? data.attachments : undefined,
        status: failed ? 'failed' : 'sent',
        error: failed ? errorMessage(error) : undefined,
        duration: Date.now() - sent.startedAt,
        messageId,
        accepted: Array.isArray(result.accepted) ? result.accepted : undefined,
        rejected: Array.isArray(result.rejected) ? result.rejected : undefined,
        transport: sent.transport,
        source: sent.source,
      },
      sent.store,
    );
  }

  private recordWith(mail: MailInfo, store: TelemetryStore | undefined): void {
    if (!this.isRecording()) return;
    try {
      const entry = this.toEntry(mail, store);
      Promise.resolve(this.storage.store(entry)).catch((err) =>
        this.logger.warn(`Could not record a mail: ${errorMessage(err)}`),
      );
    } catch (err) {
      this.logger.warn(`Could not record a mail: ${errorMessage(err)}`);
    }
  }

  private instrumentNodemailer(mailer: object, source: string): void {
    this.patch(mailer, 'sendMail', (patch) => sendMailWrapper(patch, source, true));
    const transport = peek(mailer, 'transporter');
    if (transport && typeof transport === 'object' && !isMock(transport)) {
      this.patch(transport, 'send', (patch) => transportSendWrapper(patch, mailer, source));
    }
  }

  private instrumentMailerService(service: object, source: string): void {
    for (const transporter of transportersOf(service)) this.instrumentNodemailer(transporter, source);
    if (typeof peek(service, 'addTransporter') === 'function') {
      // A transporter added later is instrumented as soon as it exists.
      this.patch(service, 'addTransporter', (patch) =>
        function (this: unknown, ...args: any[]): any {
          const result = patch.original.apply(this, args);
          try {
            ownerOf(patch)?.instrument(service, source);
          } catch {
            // The transporter is added either way.
          }
          return result;
        },
      );
    }
  }

  private patch(target: object, name: string, build: (patch: MethodPatch) => AnyFunction): void {
    let byName = patches.get(target);
    const existing = byName?.get(name);
    const current = peek(target, name);
    if (existing && current === existing.wrapper) {
      if (!existing.owners.includes(this)) {
        existing.owners.push(this);
        this.own(existing);
      }
      return;
    }
    if (typeof current !== 'function' || isMock(current)) return;
    const original = originals.get(current as AnyFunction) ?? (current as AnyFunction);
    const patch: MethodPatch = {
      target,
      name,
      original,
      wrapper: original,
      own: Object.getOwnPropertyDescriptor(target, name),
      owners: [this],
    };
    patch.wrapper = build(patch);
    originals.set(patch.wrapper, original);
    try {
      Object.defineProperty(target, name, {
        value: patch.wrapper,
        configurable: true,
        writable: true,
        enumerable: patch.own?.enumerable ?? false,
      });
    } catch (err) {
      this.logger.warn(`Cannot record the mail sent through ${describe(target)}: ${errorMessage(err)}`);
      return;
    }
    if (!byName) patches.set(target, (byName = new Map()));
    byName.set(name, patch);
    this.own(patch);
  }

  private own(patch: MethodPatch): void {
    this.owned.push(new WeakRef(patch));
    if (this.owned.length > 64 && this.owned.length % 64 === 0) {
      this.owned = this.owned.filter((reference) => reference.deref() !== undefined);
    }
  }

  private toEntry(mail: MailInfo, store: TelemetryStore | undefined): TelemetryEntry {
    const { html, text, type } = readBodies(mail);
    const failed = mail.status === 'failed';
    const to = formatAddresses(mail.to);

    const content: Record<string, any> = {
      to,
      from: formatAddresses(mail.from),
      subject: redactText(cut(asText(mail.subject), MAX_HEADER_LENGTH)),
      type,
      bodyPreview: cut(text ?? (html === undefined ? '' : htmlToText(html)), MAX_BODY_PREVIEW),
      status: failed ? 'failed' : 'sent',
      source: mail.source || 'manual',
    };
    const optional: Record<string, unknown> = {
      cc: formatAddresses(mail.cc),
      bcc: formatAddresses(mail.bcc),
      replyTo: formatAddresses(mail.replyTo),
      template: typeof mail.template === 'string' ? cut(mail.template, MAX_HEADER_LENGTH) : undefined,
      error: mail.error ? cut(String(mail.error), MAX_ERROR_LENGTH) : undefined,
      duration: typeof mail.duration === 'number' && Number.isFinite(mail.duration) ? mail.duration : undefined,
      messageId: typeof mail.messageId === 'string' ? cut(mail.messageId, MAX_HEADER_LENGTH) : undefined,
      accepted: addressList(mail.accepted),
      rejected: addressList(mail.rejected),
      transport: typeof mail.transport === 'string' ? mail.transport : undefined,
      attachments: describeAttachments(mail.attachments),
    };
    if (html !== undefined) {
      optional.html = cut(html, MAX_HTML_LENGTH);
      if (html.length > MAX_HTML_LENGTH) optional.htmlTruncated = true;
    }
    if (text !== undefined) optional.text = cut(text, MAX_TEXT_LENGTH);
    for (const [key, value] of Object.entries(optional)) {
      if (value !== undefined && value !== '') content[key] = value;
    }

    const recipients = Array.from(new Set(emailsIn(to))).slice(0, MAX_LISTED);
    return {
      uuid: uuidv4(),
      type: TelemetryEntryType.MAIL,
      createdAt: new Date(),
      batchId: store?.batchId || '',
      content,
      userIdentifier: store?.userIdentifier || '',
      tenantId: store?.tenantId || '',
      tags: ['mail', ...recipients.map((address) => `to:${address}`), ...(failed ? ['mail:failed'] : [])],
    };
  }
}

/** The nodemailer transporters a MailerService holds: the default one and the named ones. */
function transportersOf(service: object): object[] {
  const found: object[] = [];
  const main = peek(service, 'transporter');
  if (mailSourceOf(main) === 'nodemailer') found.push(main as object);
  const named = peek(service, 'transporters');
  if (named instanceof Map) {
    let seen = 0;
    for (const value of named.values()) {
      if (++seen > MAX_TRANSPORTERS) break;
      if (mailSourceOf(value) === 'nodemailer' && !found.includes(value)) found.push(value);
    }
  }
  return found;
}

// ── helpers ──────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return error === undefined ? 'Failed without a reason' : String(error);
}

function describe(target: object): string {
  return (peek(target, 'constructor') as { name?: string } | undefined)?.name || 'an object';
}

function transportName(target: object): string | undefined {
  // nodemailer: the Mail object wraps the transport.
  const transport = peek(target, 'transporter');
  const name = peek(transport, 'name');
  return typeof name === 'string' ? name : undefined;
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + TRUNCATED : text;
}

/** A body given as nodemailer takes one, as text: masked, and capped before anything walks it. */
function readContent(value: unknown): string | undefined {
  let text: string;
  if (value === undefined || value === null || value === false) return undefined;
  if (typeof value === 'string') text = value;
  else if (Buffer.isBuffer(value)) text = value.subarray(0, MAX_READ_LENGTH).toString('utf8');
  else if (value instanceof Uint8Array) {
    text = Buffer.from(value.buffer, value.byteOffset, Math.min(value.byteLength, MAX_READ_LENGTH)).toString('utf8');
  } else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else return NOT_READ;
  return redactText(text.length > MAX_READ_LENGTH ? text.slice(0, MAX_READ_LENGTH) : text);
}

function looksLikeHtml(text: string): boolean {
  return /<(?:!doctype|html|body|head|div|p|br|table|span|a|h[1-6])\b/i.test(text.slice(0, 2_000));
}

function readBodies(mail: MailInfo): { html?: string; text?: string; type: string } {
  let html = readContent(mail.html);
  let text = readContent(mail.text);
  if (typeof mail.body === 'string') {
    const kind = mail.type || (looksLikeHtml(mail.body) ? 'html' : 'text');
    if (kind === 'html') html ??= readContent(mail.body);
    else text ??= readContent(mail.body);
  }
  const type = mail.type || (html !== undefined ? 'html' : text !== undefined ? 'text' : '');
  return { html, text, type };
}

const BLOCK_TAGS = new Set([
  'br', 'p', 'div', 'tr', 'li', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'section', 'article', 'header', 'footer', 'blockquote', 'hr', 'center',
]);
// Skipped with everything up to their end tag. A <style> or <script> left open swallows the rest of
// the document, as in a browser; an unclosed <head> (allowed by HTML) does not.
const RAW_TEXT_TAGS = new Set(['style', 'script']);
const SKIPPED_TAGS = new Set(['style', 'script', 'head', 'title', 'template']);
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", copy: '©', reg: '®',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
};

/** Lower-cases A-Z only, so every index still points at the same character ('İ' would not). */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/** The `>` that ends the tag opened before `from`, ignoring one inside a quoted attribute value. */
function tagEnd(html: string, from: number): number {
  let quote = 0;
  for (let i = from; i < html.length; i++) {
    const code = html.charCodeAt(i);
    if (quote !== 0) {
      if (code === quote) quote = 0;
    } else if (code === 34 || code === 39) {
      quote = code;
    } else if (code === 62) {
      return i;
    }
  }
  return -1;
}

/**
 * The text a reader of an HTML mail sees, for the preview: no markup, no `<style>`/`<script>`/
 * `<head>`, one line per block. A plain scan with indexOf, so a hostile document stays linear.
 */
export function htmlToText(html: string): string {
  const lower = asciiLower(html);
  let out = '';
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, open);
    // As in HTML: only `<` followed by a letter, `/`, `!` or `?` opens a tag; `1 < 2` is text.
    const next = lower.charCodeAt(open + 1);
    const opensTag = (next >= 97 && next <= 122) || next === 47 || next === 33 || next === 63;
    if (!opensTag) {
      out += '<';
      i = open + 1;
      continue;
    }
    if (lower.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const close = tagEnd(html, open + 1);
    if (close === -1) {
      out += html.slice(open);
      break;
    }
    const name = /^<\/?\s*([a-z][a-z0-9-]*)/.exec(lower.slice(open, Math.min(close + 1, open + 40)))?.[1] ?? '';
    const closing = lower[open + 1] === '/';
    if (!closing && SKIPPED_TAGS.has(name) && lower[close - 1] !== '/') {
      const end = lower.indexOf(`</${name}`, close + 1);
      if (end !== -1) {
        const endClose = html.indexOf('>', end);
        i = endClose === -1 ? html.length : endClose + 1;
        continue;
      }
      if (RAW_TEXT_TAGS.has(name)) break;
    }
    if (BLOCK_TAGS.has(name)) out += '\n';
    i = close + 1;
  }
  return decodeEntities(out)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (match, code: string) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const point = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      const valid = point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff);
      return valid ? String.fromCodePoint(point) : match;
    }
    return NAMED_ENTITIES[code] ?? NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function formatAddress(value: unknown): string {
  if (typeof value === 'string') return cut(value, MAX_HEADER_LENGTH).trim();
  if (value && typeof value === 'object') {
    const name = peek(value, 'name');
    const address = peek(value, 'address');
    const email = typeof address === 'string' ? cut(address, MAX_HEADER_LENGTH).trim() : '';
    const label = typeof name === 'string' ? cut(name, MAX_HEADER_LENGTH).trim() : '';
    if (label && email) return `${label} <${email}>`;
    return email || label;
  }
  return value === undefined || value === null || value === false ? '' : cut(String(value), MAX_HEADER_LENGTH);
}

/** Addresses as one line, the way a mail client shows them: `Ana <ana@example.com>, bob@example.com`. */
function formatAddresses(value: unknown): string {
  const list = Array.isArray(value) ? value.slice(0, MAX_ADDRESSES) : [value];
  return cut(list.map(formatAddress).filter(Boolean).join(', '), MAX_HEADER_LENGTH * 2);
}

function addressList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.slice(0, MAX_LISTED).map(formatAddress).filter(Boolean);
}

/** The addresses in a formatted line. Split, not matched, so a long line stays linear. */
function emailsIn(addresses: string): string[] {
  const found = addresses.split(/[\s<>,;:"'()]+/).filter((token) => {
    const at = token.indexOf('@');
    return at > 0 && at < token.length - 1;
  });
  return found.length > 0 ? found : addresses ? [cut(addresses, 200)] : [];
}

/** A file name from a path or URL: no directory, no query string, no fragment. */
function fileNameOf(location: unknown): string {
  if (typeof location !== 'string' || location.startsWith('data:')) return '';
  const path = location.split(/[?#]/)[0];
  return (path.split(/[\\/]/).pop() ?? '').slice(0, 200);
}

function describeAttachments(
  value: unknown,
): Array<{ filename: string; contentType: string; size?: number }> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.slice(0, MAX_LISTED).map((attachment: unknown) => {
    const item = asRecord(attachment);
    const filename =
      typeof item.filename === 'string'
        ? fileNameOf(item.filename) || item.filename.slice(0, 200)
        : fileNameOf(item.path) || fileNameOf(item.href);
    const contentType = typeof item.contentType === 'string' ? item.contentType.slice(0, 200) : '';
    const content = item.content;
    const size =
      typeof content === 'string'
        ? Buffer.byteLength(content, item.encoding === 'base64' ? 'base64' : 'utf8')
        : Buffer.isBuffer(content)
          ? content.length
          : undefined;
    return size === undefined ? { filename, contentType } : { filename, contentType, size };
  });
}
