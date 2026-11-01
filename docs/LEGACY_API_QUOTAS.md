# Default API quotas

Prepared from main `c615cb8fa868c1971cbda4411efa2319faae9b47` for the
October 31 task P0.2. This is a source and deployment contract, not a production
database receipt or permission to activate a feature flag.

## Accepted writes

| Operation | Limit | Counting and reset |
| --- | --- | --- |
| New events, keyed and unkeyed combined | 60 per verified user per 60-second window | Existing `event_rate_limits` counter and SQL function; a rejected event spends no unit |
| New events in one session | 500 total | Counts all stored events in that session; waiting does not reset this cap |
| New session starts | 30 per verified user per one-hour window | Separate server-timed window anchored to its first accepted start; resets after 3,600 seconds |

One driver profile belongs to one authenticated user. Identity comes from the
verified bearer token; supplied driver, fleet and user claims confer no authority.
The start function derives the current driver and fleet in the database and
assigns start time after its required locks. No alert threshold, local monitoring
timing, consent policy or event identity flag is changed.

The legacy event handler calls the existing `record_idempotent_event` function
with `p_client_event_id = null`. Its keyed branch and canonical SQL remain
unchanged. Both paths use the same locked counter and session-cap query, so
switching between paths cannot create a second allowance. Unkeyed calls remain
independent writes; a timeout never authorizes automatic retries or invents an
idempotency key. Their response retains the legacy event/trust/message shape.

New starts use `start_rate_limited_session`, with verified user, optional session
UUID and normalized device/browser/provenance values. It accepts no caller-chosen
driver, fleet or start timestamp. An owned UUID replay returns the original row,
including completed summary and historical fleet, even after quota exhaustion.
Replay, foreign UUID conflicts and failed inserts spend no quota unit. The API
retains `session_start_protocol: "client_uuid_v1"`; GET and PATCH contracts are
unchanged. This does not add client retries or a persistent start-intent queue.

## Rejections and concurrency

Legacy event errors `event_rate_limited` and `session_event_limit` return 429.
The burst limit carries a sanitized `Retry-After` between 1 and 60 seconds;
the permanent session cap uses a 60-second minimum backoff. That header does not
promise the request will succeed later or reset a session's 500-event cap.
Session start error `session_start_rate_limited` returns 429 with a sanitized
`Retry-After` between 1 and 3,600 seconds. A foreign session UUID returns opaque
409 `session_id_conflict`, without returning the other driver's row. Bounded
membership churn can return 409 `membership_changed` without creating a session.

The session-start transaction locks the actor's auth parent, current fleet,
driver, then quota bucket. It revalidates the membership snapshot with at most
three pre-insert read/lock attempts, releasing stale locks between attempts.
Only that preparation is repeated; an insert is never retried. The unique UUID
conflict handler rolls back its insert scope, including any newly initialized
counter row. Counter increment and accepted session creation commit together.

`session_start_rate_limits` stores only user ID, window start and count, with
account-deletion cascade. It has RLS and no client policies, explicit service-role
CRUD grants and no client table access. The narrowly scoped start function is
SECURITY DEFINER with a fixed search path and qualified tables, callable only by
`service_role`; it does not grant clients or the service role broader direct
access to `auth.users`. The existing event function remains SECURITY INVOKER.

## Required deployment order

Main automatically deploys dependent API code. Keep the source PR unmerged until
the database prerequisites have been separately approved, applied and verified:

The branch-specific `vercel.json` rule disables automatic deployments from
`codex/legacy-event-quota`, allowing source review and GitHub CI before those
prerequisites are ready. Main retains its existing automatic deployment behavior.
This uses Vercel's documented [branch deployment configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled);
it is not a database-readiness assertion or a feature flag activation.

1. Inspect the intended project's migration ledger and deployed definitions.
   Verify `20261026164040_atomic_event_idempotency.sql` and its service-role
   permissions; do not replay an already-applied migration. Do not apply the
   overlapping old PR #192 quota proposal.
2. Apply the new `20261031192453_session_start_quota.sql` once, then inspect its
   function definition/owner/security/search path/EXECUTE ACL, table RLS,
   service-role CRUD grants and account-deletion foreign key. A ledger entry
   alone does not verify these definitions.
3. Complete scoped acceptance on authorized synthetic test accounts and review
   the exact source and checks before merging/deploying. Missing RPCs fail
   closed; there is no unlimited direct-insert fallback.
4. Keep `OCCULERT_EVENT_IDEMPOTENCY_ENABLED` off unless its separate rollout is
   selected. After deployment, the default unkeyed quotas do not depend on that
   flag. No web/native outbox is enabled by these changes.

Production observations and operational receipts remain private. Local PGlite
and isolated PostgreSQL tests do not establish deployed definitions or genuine
signed-in account acceptance. See [backend setup](../BACKEND_SETUP.md),
[migration readiness](MIGRATION_READINESS.md) and
[event identity](EVENT_IDEMPOTENCY.md).

## Verification

The quota regressions exercise actual SQL caps, server-window reset, free replay,
cross-driver isolation, rollback, grants/RLS and deletion, plus actual API status,
Retry-After, identity and no-fallback behavior. Independent PostgreSQL connections
provide separate evidence for contested boundaries and lock ordering; serialized
PGlite requests are not a multi-connection race proof. Run the full root
verification and required hosted PR checks before deployment review.
