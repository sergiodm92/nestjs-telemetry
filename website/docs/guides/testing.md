---
title: Testing with telemetry
description: Use the recorded entries in your own end-to-end tests, keep telemetry out of unit tests, and avoid hanging test runs.
---

The storage is injectable, so an end-to-end test can assert on what a request recorded: that it sent a mail, ran a query or raised an exception.

## Read entries in an e2e test

```ts title="test/signup.e2e-spec.ts"
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TELEMETRY_STORAGE, TelemetryEntryType, TelemetryStorage } from '@nestjs-telemetry/core';
import { AppModule } from '../src/app.module';

/** Polls until `done` holds: entries are written when a response ends, and SQLite buffers them. */
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('sign-up', () => {
  let app: INestApplication;
  let storage: TelemetryStorage;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    storage = app.get(TELEMETRY_STORAGE);
  });

  afterAll(() => app.close());

  beforeEach(() => storage.clear());

  it('sends a welcome mail in the same request', async () => {
    await request(app.getHttpServer()).post('/auth/signup').send({ email: 'ana@example.com' }).expect(201);

    const mails = await eventually(
      () => storage.getByType(TelemetryEntryType.MAIL, {}, 0, 10),
      (list) => list.length > 0,
    );
    expect(mails[0].content).toMatchObject({ to: 'ana@example.com', status: 'sent' });

    const related = await storage.getByBatchId(mails[0].batchId);
    expect(related.map((entry) => entry.type)).toContain(TelemetryEntryType.REQUEST);
  });
});
```

Notes:

- Keep the default in-memory storage in tests: nothing to clean up, and reads are immediate.
- A `REQUEST` entry is written when its response ends, which can be just after supertest resolves: poll as above rather than reading once.
- With a mocked mailer (`jest.fn()` or `jest.spyOn`), the mock is left as it is and your assertions keep working; a spy that calls through is still recorded at the transport.
- To replace the storage in a test, use `.overrideProvider(TELEMETRY_STORAGE).useValue(...)`.

## Always close the app

The module starts two timers (prune and flush) when it is created. `app.close()` stops them, flushes SQLite and puts back what mail instrumentation replaced. A test file that creates an app and never closes it keeps Jest from exiting ("Jest did not exit one second after the test run has completed").

## Keep it out of unit tests

Unit tests that build a single provider with `Test.createTestingModule({ providers: [...] })` do not import `TelemetryModule` and are unaffected. If your tests import `AppModule`, you can turn the automatic parts off with `watchers: { requests: false, exceptions: false, cache: false, mail: false }`, or register the module only when an environment variable allows it.

## The repository's own harness

`packages/core/test/support/test-app.ts` builds a real Nest application with the module installed (memory or SQLite, `forRoot` or `forRootAsync`, an optional global prefix) and exposes `eventually()`, `waitForRequests()` and a demo controller. It is a good template for testing integrations of your own.
