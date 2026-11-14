# Profile and fleet write quotas

W2 is prepared from main `c03a0a9b1127b51f5ca5791ea1fc871e22c0c5ce`.
This document describes the source contract and a deployment prerequisite. It
does not assert that any migration has been applied to a hosted database.

## Limits and counting

| Route and operation | Limit per verified account | What spends one unit |
| --- | --- | --- |
| `POST /api/profile`, `profile` | 60 attempts per one-hour window | A valid JSON request admitted before driver lookup/update/creation, including an empty onboarding refresh |
| `POST /api/fleets`, `fleet` | 10 attempts per one-hour window | A verified-email request with a valid company name when the initial lookup found no owned fleet |

These limits permit repeated onboarding, ordinary account edits and creation
recovery while bounding one account's admitted writes. They are separate from
event, session-start, invitation and pilot-lead quotas. The policy is fixed in
the database; the caller cannot supply a limit, clock, actor or operation.
The server derives the actor from the verified bearer token and uses the fixed
operation for its route. Both routes continue to fetch current Auth details.

Each window starts at the database time of its first admitted reservation and
lasts 3,600 seconds. The next admitted request after expiry starts a new window.
Denied requests leave the count and window unchanged. This is a fixed window,
so requests immediately before and after its boundary can use consecutive
allowances; it is not a sliding-window traffic limit.

A reservation is a separate committed transaction before the route's later
mutation. The quota therefore counts **admitted attempts**, including failed
writes, a request that runs out of its provider budget after reservation, and
concurrent-creation losers. A profile insert conflict may perform the existing
owner-scoped display-field recovery PATCH under that same reservation. It does
not reserve again. Fleet insert conflicts retain their existing read-only
owner lookup. No reservation is refunded and no mutation is automatically
retried: an ambiguous timeout cannot prove whether the database committed.

Invalid JSON bodies and rejected company names do not reserve quota. Non-text
profile fields retain the released missing-field behavior and can still result
in an admitted identity refresh. Existing-owned fleet POST requests remain a
read-only 200 after their existing body validation, even when creation quota is
exhausted; GET remains unchanged. Supplied owner, user, fleet, role and plan
claims remain ignored. No pilot-lead or honeypot behavior changes.

## Durable storage and concurrency

`public.account_write_rate_limits` stores at most two rows per authenticated
account: `(user_id, operation)`, window start and count. Its auth-user foreign
key cascades on account deletion. A missing profile or fleet cannot bypass the
quota because the counter depends on the auth parent, not a driver row.

The service-only `reserve_account_write(uuid,text)` function first takes a key
share lock on that auth parent, following account deletion's parent-before-child
order. A unique insert followed by a quota-row lock serializes first insertion
and subsequent checks/increments for the same account and operation. The clock
is read after contention. The function does not hold a driver or fleet lock or
require those rows to exist. Deleted accounts cannot leave orphan counters.

The new table has RLS enabled with no client policies. PUBLIC, `anon` and
`authenticated` have no table privileges or function EXECUTE permission;
`service_role` receives explicit table CRUD and function EXECUTE grants. The
narrow SECURITY DEFINER function uses `search_path = pg_catalog, pg_temp` and
qualified table names so it can lock the auth parent without granting the
service role direct access to `auth.users`.

## API responses and failure handling

An exhausted quota returns HTTP 429 with
`{ "ok": false, "error": "account_write_rate_limited" }` and `Retry-After` equal
to the ceiling of the remaining window seconds, bounded from 1 through 3,600.
The header is a minimum retry delay, not a promise that a later write succeeds.
Accounts deleted between Auth verification and reservation return opaque 401
`unauthorized`.

The API requires the exact success shape, boolean `allowed: true`, matching
account UUID and matching server operation. Missing, contradictory, unknown or
malformed results return 502 `write_quota_unavailable` and cannot reach the
driver/fleet mutation. A quota denial also requires the documented shape and a
bounded integer retry value. Provider exceptions retain the existing opaque
`supabase_error` envelope: deadlines return 504, marked upstream outages return
503, and missing migrations or other invalid provider responses return 502.
The existing shared provider budget still covers Auth, reservation and storage.

## Required deployment order

1. Review the intended project's migration ledger and deployed definitions.
   Do not replay the baseline, earlier quotas or an already-applied migration.
2. With separate production approval, apply
   `20261114183018_account_write_quota.sql` once before deploying either
   dependent POST route. Verify the actual function
   definition, owner, SECURITY DEFINER/search path, service-only EXECUTE ACL,
   quota table constraints, RLS, grants and auth-user deletion cascade. A ledger
   entry alone does not verify them.
3. Perform scoped acceptance with authorized synthetic accounts, then complete
   the source review and required PR checks before merging/deploying the API.
   Missing prerequisites fail closed; there is no direct-write fallback.

`vercel.json` disables automatic deployments only for the prepared
`codex/profile-write-quota` branch, following the existing quota-branch
convention. Main retains its automatic deployment behavior; keep the source PR
unmerged until the database prerequisite is applied and verified. No deployment,
migration application or feature-flag activation is authorized by these tests.

## Verification

`npm run test:account-write-quota` executes the actual migration chain in PGlite
and the actual profile/fleet handlers. It covers limits, window reset, denied
state preservation, first-profile creation, account/operation isolation, grants,
RLS, cascade, malformed RPC results, provider failures and write/race behavior.
Simultaneously submitted PGlite calls exercise queued boundary behavior; PGlite
serializes work on one connection, so they are not a multi-connection lock-race
proof. API tests retain the strict input and identity contracts from main.
Run `npm ci && npm run verify` and the required hosted PR checks before release.

The existing **Event PostgreSQL Concurrency** workflow separately runs
`scripts/test-event-idempotency-concurrency.mjs` with 12 independent connections
to an isolated PostgreSQL 17 instance. Its seven additional account-quota
scenarios cover first-bucket contention and final-slot races for both
operations, account deletion winning or losing the parent lock, and window
time after an observed lock wait. The twelve earlier event/session scenarios
remain in that run. Locks are observed through backend blocking dependencies;
the tests do not infer contention from a sleep.

For a local run, install the locked client and provide PostgreSQL 17 binaries:

```sh
npm ci --ignore-scripts --prefix scripts/event-concurrency-runtime
OCCULERT_PG_TEST_RUNTIME="$PWD/scripts/event-concurrency-runtime" \
OCCULERT_PG_BIN="/absolute/path/to/PostgreSQL-17/bin" \
OCCULERT_PG_RECEIPT_DIR="/absolute/path/to/test-receipts" \
node scripts/test-event-idempotency-concurrency.mjs
```

CI builds its binaries with the existing checksum-pinned
`scripts/build-concurrency-postgres.sh`. The harness accepts no database URL,
uses a private Unix socket with TCP disabled, and removes its synthetic cluster.
It emits `event-concurrency.json` only after every scenario and cleanup succeeds,
including the source commit and account-quota migration SHA-256. A PGlite pass
or syntax check does not substitute for this separate PostgreSQL receipt.

Local tests do not establish deployed definitions or real signed-in acceptance.
See [backend setup](../BACKEND_SETUP.md),
[migration readiness](MIGRATION_READINESS.md) and
[event/session quotas](LEGACY_API_QUOTAS.md).
