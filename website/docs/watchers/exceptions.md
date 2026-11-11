---
title: Exceptions
description: How exceptions are recorded without changing your error handling, what an EXCEPTION entry holds, how to record one yourself, and why not to use TelemetryExceptionFilter.
---

`TelemetryExceptionInterceptor` is bound as a global interceptor. When a handler, or a pipe in front of it, throws, it records an `EXCEPTION` entry and re-throws the same error, so your exception filters and Nest's default handling run unchanged.

## What is recorded

| Field | Content |
| --- | --- |
| `class` | The error's constructor name (`NotFoundException`, `TypeError`...), or `UnknownError`. |
| `message` | `error.message`, or `String(error)`. Not masked. |
| `trace` | The stack trace, cut at 5,000 characters. |
| `file`, `line`, `location` | The first frame of the stack, when it has the `(file:line:column)` form. |
| `uri`, `method` | The request's path (or URL) and method. |
| `cause` | `String(error.cause)` when the error has a cause. |

Tags: `exception:<ClassName>`. The entry carries the request's batch ID, user and tenant, so it shows up next to the request in the dashboard.

## Which errors are recorded

Every error that reaches the interceptor, `HttpException`s included: a `NotFoundException` or a validation `BadRequestException` is recorded like a crash. Errors thrown before the interceptor chain (in middleware or guards) are not recorded, and neither are routes that match nothing.

The request watcher records the same request with its final status, so a `500` appears in **Requests** and in **Exceptions**, linked by the batch.

## Recording an exception yourself

`recordException(storage, error, request)` writes the same entry. Use it from your own exception filter, for errors handled outside a handler:

```ts title="src/all-exceptions.filter.ts"
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Inject } from '@nestjs/common';
import { TELEMETRY_STORAGE, TelemetryStorage, recordException } from '@nestjs-telemetry/core';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(TELEMETRY_STORAGE) private readonly storage: TelemetryStorage) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    recordException(this.storage, exception, http.getRequest());
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    http.getResponse().status(status).json({ statusCode: status });
  }
}
```

`recordException` returns nothing and does not wait for the storage; it skips recording while recording is paused. If the global interceptor already saw the same error, both entries are kept.

## TelemetryExceptionFilter

`TelemetryExceptionFilter` is exported for scoped use, but avoid it:

:::warning[Current limitation]
The filter re-throws the exception from `catch()`. Registered by class (`@UseFilters(TelemetryExceptionFilter)`), Nest cannot resolve its constructor argument and the app fails at startup; registered as an instance, the re-thrown error escapes Nest's exception layer and can crash the process. Record from your own filter with `recordException()` instead, as above.
:::

## Turning it off

`watchers: { exceptions: false }` binds a pass-through interceptor instead.
