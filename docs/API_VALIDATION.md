# API validation contracts

`api/_lib/responses.js` serializes caller-supplied payloads with the caller's
status, JSON UTF-8 content type and `Cache-Control: no-store`. It preserves
headers already set by a handler. The history and period-report routes retain
`Vary: Authorization` wrappers; billing retains its `nosniff` wrapper. Router
errors have only `error`, while individual handlers retain their own envelopes.

`api/_lib/validation.js` contains parsed-object checks. These routes require
exact `application/json` media type, case-insensitive, with optional parameters
and surrounding whitespace. Pseudo-types such as `application/jsonp` and
`text/plain; application/json` are rejected before writes. JSON text strings
are not parsed by these object routes. Limits count serialized JavaScript
characters, preserving their existing Unicode behavior.

| Route | Serialized character limit | Body rejection |
| --- | ---: | --- |
| sessions POST/PATCH, events POST | 4096 | 415 `invalid_json_body` |
| profile POST, fleets POST, fleet-invitations POST/DELETE | 2048 | 415 `invalid_json_body` |
| accept-invitation POST | 1024 | 415 `invalid_json_body` |
| account DELETE | 256 plus exact `confirm: 'DELETE'` | 400 `confirmation_required` |
| fleet-followups POST | 1024 | 400 `invalid_body`, then separate 400 `invalid_followup` schema errors |
| pilot-leads POST | 4096 | Separate 415 media, 400 array-body, 413 size and 400 lead-field stages |

Retain each handler's existing method/config/authentication/ownership ordering.
In particular, account confirmation precedes authentication; fleet creation's
owner lookup precedes body validation; followup ownership precedes body/schema
validation. Pilot origin and media checks precede its durable rate check, which
precedes object and size checks. Pilot's legacy missing/scalar bodies normalize
to an empty object and retain `invalid_lead`. The shared size predicate rejects
unserializable objects without a write.

Billing's separate parser remains in `api/_lib/billing-test.js`: checkout accepts
an object or JSON string within 2048 UTF-8 bytes, with its existing anchored media
rule and exact `plan` schema. Portal and status do not require a JSON body. The
webhook retains its original raw async stream, 1 MiB byte limit and signature
verification before parsing. Never replace these with the parsed-object helper.

Session UUIDs use a strict string of exactly 36 characters with canonical
8-4-4-4-12 hexadecimal groups, regardless of version/variant bits. Sessions,
events, cursors, summary event lookup and followups share that accepted set.
UUID shape does not establish ownership: verified driver/fleet/owner queries
and cursor timestamp/filter bounds remain required. Invitation and billing
UUID formats intentionally retain their separate version/variant policies.

Client metric helpers accept numbers and numeric strings, preserve zero, reject
missing/boolean/blank/non-finite values, and clamp to explicit ranges. Session
counts additionally round within 0–10000. Followup `expected_version` remains a
strict numeric integer in 0–2147483646. Trusted report counts, provider prices
and timestamps retain their own strict checks; do not clamp invalid domain data.

`npm run test:api-validation` covers helper shapes plus actual route body and
response contracts. The existing API security, database, billing raw-signature,
tenant, cursor and transport suites remain separate required verification steps.
