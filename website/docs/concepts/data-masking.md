---
title: Data masking
description: Exactly what is masked before an entry is stored - headers, query strings, bodies, responses and mail - how keys are matched, and what is stored as it is.
---

Masking happens before an entry is stored: what is masked never reaches the storage or the dashboard. It follows one principle, stated in the code: a dashboard that hides one field too many is a nuisance; one that shows a credential is a leak. Masked values become `***`.

## How a key is judged sensitive

A key (header name, query parameter, JSON field at any depth) is first normalized: lower-cased, with spaces, `.`, `_` and `-` removed. So `X-Api-Key`, `new_password`, `refreshToken` and `card number` all become comparable. It is sensitive when the normalized key:

- **contains** one of: `password`, `passwd`, `passcode`, `secret`, `token`, `apikey`, `authorization`, `cardnumber`, `cvv`, `cvc`, `privatekey`, `credential`, `twofactor`;
- or **is exactly** one of: `code`, `otp`, `pin`, `pwd`, `pass`, `jwt`, `auth`, `bearer`, `cookie`.

The short names must match whole, because as substrings they would hit innocent keys (`postcode`, `shipping`, `statusCode`). Over-masking is accepted: `tokenType` is masked too.

In **responses**, `code` is not in the list: a server's `code` is nearly always an error or status code (`{"code":"401"}`), so it stays readable. A verification code in a response is still caught by the other names or by its shape.

## Requests

| Part | Rule |
| --- | --- |
| `Authorization`, `Cookie`, `Set-Cookie` | Always `***`. |
| Any other header with a sensitive name | `***` (`x-api-key`, `x-auth-token`...). |
| `Location`, `Content-Location`, `Referer`, `Refresh` | The query string and fragment of the URL are masked like a query string. |
| Query string | Pair by pair: a sensitive key gets `***`; so does a value that is itself a URL or query string containing a sensitive key (`?next=https://app/reset?token=...`). |
| JSON body | Every sensitive field at any depth, arrays included. A string value that holds a JSON document is parsed and masked field by field. Any other string value has its JWTs masked. |
| Text body | Parsed as JSON when it is JSON. Otherwise JWTs are masked, and if the text mentions a sensitive name (`password=...`) the whole body becomes `***`. |
| Binary body (`Buffer`) | Not stored: `[binary body omitted]`. |

Bodies are masked first and cut at 10,000 characters afterwards, so truncation never exposes half of a masked value.

## Responses

The response body is captured only when it is text (JSON, XML, `text/*` except event streams), uncompressed, not UTF-16/32 and at most 256 KB; then masked with the same rules as a request body (minus `code`) and cut at 10,000 characters. Response headers follow the header rules above, `Set-Cookie` included. See [Requests](../watchers/requests.md#response-capture) for the capture rules.

## JWTs

A signed JWT is recognised by its shape: three base64url parts where the first two start with `eyJ`. It is masked in JSON string values, text bodies and mail, even under an innocent key or in free text. The match only starts where a run of base64url characters starts, so it stays fast on hostile input.

## Mail

A mail body has no field names, so it is masked by shape: JWTs, and the query string and fragment of every URL in it, `href` attributes included (`https://app/reset?token=...` keeps the address and loses the token). The subject is masked for JWTs. See [Mail](../watchers/mail.md#masking).

## What is not masked

:::warning
These are stored as they are. Keep them in mind before you run the dashboard where others can see it, or with real users' data.
:::

- **URL paths**: `/orders/track/:token` keeps its token.
- **Header values and query values under innocent names**, JWTs included: `x-session: eyJ...` or `?state=eyJ...` are stored as sent.
- **Exception messages and stack traces.**
- **SQL and its parameters** (TypeORM), and **Prisma arguments and data**: a password hash or a token bound to a query is visible.
- **Log messages**, contexts and traces.
- **Event payloads.**
- **Model data**: changed fields (TypeORM) and written data (Prisma).
- **Cache keys.**
- **Mail addresses**, and codes written in the text of a mail ("your code is 123456").
- **User identifiers**: the request's user is identified by `email` first, so email addresses appear in every entry's `userIdentifier`.

Masking hides credentials, not personal data. Treat the dashboard as holding production-grade personal data whenever it records real traffic.
