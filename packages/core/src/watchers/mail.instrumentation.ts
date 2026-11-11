import { OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { TelemetryMailWatcher, mailSourceOf } from './mail.watcher';

// Properties looked at per provider. A provider is a service, not a data structure: past this
// many own properties it is not worth walking.
const MAX_PROPERTIES = 200;
const MAX_MAP_VALUES = 50;

/**
 * Finds the mail senders the application registered and has the mail watcher record what they
 * send, so `watchers.mail` works with no code in the host: a nodemailer transporter or a
 * `MailerService` (`@nestjs-modules/mailer`) that is a provider itself (`{ provide: 'MAIL',
 * useFactory: () => createTransport(...) }`), or that a provider or controller holds in one of its
 * own fields, directly or as a value of a Map field (`this.transporter = createTransport(...)`).
 *
 * It runs once, in `onApplicationBootstrap`: after every module's `onModuleInit`, so a
 * transporter created there is found too. A transporter created later than that, or kept further
 * down an object graph, is not: hand it to `TelemetryMailWatcher.instrument()`.
 */
export class TelemetryMailInstrumentation implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly watcher: TelemetryMailWatcher,
    private readonly enabled: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    const seen = new Set<object>();
    const wrappers = [...this.discovery.getProviders(), ...this.discovery.getControllers()];
    for (const wrapper of wrappers) {
      for (const instance of instancesOf(wrapper)) this.inspect(instance, seen);
    }
  }

  private inspect(instance: unknown, seen: Set<object>): void {
    if (!isWalkable(instance) || seen.has(instance)) return;
    seen.add(instance);
    if (this.instrument(instance)) return;
    for (const value of ownValues(instance)) {
      if (value instanceof Map) {
        let count = 0;
        for (const item of value.values()) {
          if (++count > MAX_MAP_VALUES) break;
          if (isWalkable(item) && !seen.has(item)) {
            seen.add(item);
            this.instrument(item);
          }
        }
        continue;
      }
      if (!isWalkable(value) || seen.has(value)) continue;
      seen.add(value);
      this.instrument(value);
    }
  }

  private instrument(candidate: object): boolean {
    const source = mailSourceOf(candidate);
    if (!source) return false;
    this.watcher.instrument(candidate, source);
    return true;
  }
}

/** The singleton instance of a provider, or the instances of a transient one. */
function instancesOf(wrapper: InstanceWrapper): unknown[] {
  const found: unknown[] = [];
  try {
    found.push(wrapper.instance);
    if (wrapper.isTransient) {
      for (const perContext of wrapper.getStaticTransientInstances() ?? []) found.push(perContext?.instance);
    }
  } catch {
    // A wrapper that cannot hand out its instance has nothing to find.
  }
  return found;
}

function isWalkable(value: unknown): value is object {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !ArrayBuffer.isView(value)
  );
}

/** The values of an object's own data properties. Getters are never run. */
function ownValues(target: object): unknown[] {
  const values: unknown[] = [];
  try {
    for (const key of Object.getOwnPropertyNames(target).slice(0, MAX_PROPERTIES)) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor && 'value' in descriptor) values.push(descriptor.value);
    }
  } catch {
    // A proxy that refuses to be inspected: nothing to find in it.
  }
  return values;
}
