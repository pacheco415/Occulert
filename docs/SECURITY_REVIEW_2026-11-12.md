# Occulert security and reliability review — November 12, 2026

## Scope and source

This review started from `main` at `1b4e1854bf68d46d82138949b67438f99acccb12`,
including the security-policy hardening in #418 and SDK alignment in #417.
The work is on `codex/deep-security-bugfix-2026-11-12`. It covers the website,
API, native cloud/account lifecycle, offline caching, fleet records, release
assets, and dependency tree. This is an engineering review with reproducible
regressions, not a security certification or proof that no other bug exists.

Independent reviewers covered backend, browser and native paths, followed by
integration review. The Codex Security deep-scan coordinator is not exposed in
this workspace; this document records the direct engineering review and its
tests, not a sealed result from that unavailable scanner.

During final validation, #419's fleet driver detail panel merged into `main`
at `98143eabab36fa0c69546e0f9b54f99748c1bd89`. The patch integrates that
change, preserves its panel and tests, and releases the combined dashboard
under a fresh immutable URL. The integration review also covers the panel's
response validation and clearing of prior-account presentation state.

The reviewers used synthetic records and hardware adapters for behavioral
tests. Live database checks were limited to schema, privileges, migration
metadata and security advisories; no driver records were fetched or modified.
No schema migration, billing activation, detection-threshold change or
experiment activation is included.

## Reproduced findings and repairs

Severity below describes the observed product impact, not a CVSS assessment.
Conditional transport findings do not establish an actual credential leak.

| Area | Finding | Repair and evidence |
| --- | --- | --- |
| Native sharing — moderate privacy | A failed or stalled summary-queue removal could leave an opt-out unsaved. An older pending enable action could also persist sharing after a newer disable or account transition. | Save opt-out before cleanup on every path; check consent/account generation after asynchronous prerequisites and before opt-in persistence. Actual-module regressions cover failed/stalled cleanup, newer opt-out, logout and replacement login. |
| Native sign-out — moderate privacy/reliability | Secure-store deletion failures appeared successful; a stalled deletion could keep the interface busy indefinitely. Saved credentials could reappear after restart when local deletion and remote revocation were unavailable. | Clear runtime authority immediately, report incomplete cleanup, and provide Retry sign-out. Bound the explicit caller's wait to the existing eight-second deadline while preserving the actual storage queue barrier. Tests verify that late deletion cannot erase a newer login. Refused storage deletion is reported honestly; the code cannot promise permanent removal when the OS refuses it. |
| API provider redirects — moderate, conditional credential exposure | Default redirect following could forward Supabase's custom `apikey` header or a provider mutation to another destination. | Refuse redirects in central Supabase and Stripe transport. A two-server loopback regression verifies zero requests to the redirected destination for Auth, REST POST and admin DELETE. |
| Stripe response bounds — moderate availability | The 256 KiB limit was checked only after the entire response had been buffered. | Enforce decoded byte limits while streaming, reject oversized advertised lengths before reading, cancel at the first overflowing chunk, and retain the existing deadline and no-retry behavior. Tests include misleading lengths, exact-limit UTF-8 and malformed/provider failures. |
| GPS lifecycle — moderate privacy/data integrity | A queued callback from a stopped watcher could alter saved location or a subsequent session. Optional GPS exceptions could interrupt camera start or stop. | Invalidate watcher generations before clearing them and require current monitoring, consent and foreground visibility. Contain optional geolocation failures. Synthetic lifecycle and browser regressions cover late callbacks and thrown watch/clear operations. |
| Foreground stop — moderate reliability | An old stop operation waiting on cloud work could overwrite the state shown for a newly started session. | Display the stopped warning during immediate local shutdown, before awaiting optional cloud completion. A delayed-completion regression preserves the new session's running state. |
| Offline shell and query storage — moderate privacy/availability | Query variants could miss installed static files, make the offline driver load the homepage, or retain login-link query values as cache keys. | Canonical fallback is limited to known static/pinned paths. Query-bearing network responses are never persisted or used to replace canonical bytes. Authorization and Range requests bypass the cache. Tests preserve optional-runtime hash/SRI validation and reject poisoned query entries. |
| Fleet follow-ups — low availability/data quality | An unbounded roster fetch could hit the provider's row cap before reaching a driver referenced by the displayed session page. | Fetch only the distinct driver IDs from the at-most-50 scoped sessions, retain the fleet predicate, bound related reads, and reject malformed, duplicate or unrequested driver IDs and excessive related rows. Empty pages skip both related lookups. |
| Dashboard saved data — low availability | Malformed local JSON names, IDs, dates, numbers or nested events could throw during normalization, history, pilot metrics or refresh. | Accept bounded primitive values, reject malformed containers and event identities, preserve valid zero values, and leave original stored bytes untouched. Regressions include non-callable JSON coercion properties. |
| Fleet detail integration — low privacy/data quality | The newly merged panel retained the previous driver's name in its hidden title after account reset, and its response validator accepted an array as a session ID. | Clear the title together with the rest of the panel and require a string session ID before UUID validation. Regression cases cover malformed IDs, account reset, close and delayed responses. |
| Session export and notifications — low reliability | The session CSV carried rows across successful restarts, and each alert used a unique notification tag. | Compose the prepared source/test fixes from #408 and #411: reset CSV only after successful start and use a stable notification tag with renotification. Failed starts preserve the preceding export. |
| Cloud verification and bundle size | Dead `OcculertSync` hooks had no implementation, while test stubs could make them appear to be a real upload path. | Compose the prepared source/test change from #412. Retain the actual authenticated backend flow and test it with intercepted provider responses. This also keeps the combined driver below its existing size budget. |
| Native build tooling — moderate advisory | Two `glob@13.0.6` dependency paths continued filesystem traversal after cancellation. | Install the compatible published 13.0.7 backport only on those two paths. Real-package regressions change from 40 total directory reads despite cancellation to one initial read. Dependency ranges and parent packages are unchanged. See [dependency evidence](DEPENDENCY_AUDITS.md). |

## Access-control and deployment observations

Live Supabase metadata on November 12 (Pacific) showed:

- All 15 public tables have row-level security enabled.
- `anon` and `authenticated` have no direct SELECT, INSERT, UPDATE or DELETE
  privilege on those tables; the server role retains access.
- All 15 public application routines deny execution to ordinary client roles
  and permit the server role. Privileged routines have explicit search paths.
- The 11 informational "RLS enabled, no policy" notices correspond to
  server-only tables with client privileges denied. Adding permissive client
  policies merely to silence these notices would weaken the access model.
- Leaked-password protection is disabled. The connected database tools cannot
  change this Auth setting, and the dashboard inspection reached a sign-in
  wall. No authentication setting or subscription was changed. Supabase's
  [password-security documentation](https://supabase.com/docs/guides/auth/password-security)
  states that leaked-password protection requires Pro or higher.

The baseline production `/api/public-config` response was configured for the
pinned Supabase host and used a publishable key. It returned `no-store`, HSTS,
`nosniff`, anti-framing headers and the owned-script/exact-host CSP. These are
observations of the baseline deployment, not proof of a future release.
The provider's protected-fetch helper could not expose the other anonymous
API responses reliably, so its authentication errors are not counted as an
application-level authorization test.

A targeted scan of tracked text checked private-key markers, common provider
secret/token formats and embedded Supabase service-role JWTs without printing
candidate values. It found no matching credential. This does not replace
provider secret scanning or a complete historical credential audit.

## Release and verification

The release tool generated new driver, dashboard and startup-guard URLs;
previously committed versioned asset bytes remain unchanged. HTML, SRI,
manifests, service-worker lists/cache identity and immutable headers are
updated together. The compiled driver is 126,849 bytes against the unchanged
127,000-byte limit. All 13 registered source/output pairs are audited.

Final local and hosted verification results belong to the pull request's exact
head. Required Site Audit, Chromium/WebKit Browser Smoke Tests and Native App
Typecheck must pass before merge, then run on resulting main as required by
[RELEASING.md](../RELEASING.md). No gate, retry report, platform skip or
dependency warning is suppressed by this change.

The final native verification passed the ordinary Expo dependency gate,
TypeScript and 257 tests with zero failures. Three existing Swift-dependent
tests were skipped on Linux and remain covered by the macOS CI job. Both site
and native dependencies were installed with their prescribed clean-install
commands. Site verification passed all 110 steps before integrating #419. Its
initial release-fixture failure was resolved by staging the newly generated
assets, and the subsequent complete run had zero failed steps. The pull request
records final integration verification and hosted results for the committed
patch, including #419's additional verification step.

Local browser installation failed because the downloaded Chromium archive was
truncated; local Playwright collection succeeded, but collection is not browser
execution. Hosted browser results are therefore required. Linux-native checks
cannot exercise the existing macOS/Swift-only cases or physical device behavior.

## Remaining boundaries

- Fresh dependency reports still contain 3 moderate site entries and 8
  moderate plus 1 low native entries; neither tree reports a high or critical
  entry. These are affected-package counts, not distinct exploitable bugs.
  The compatible glob backport does not clear the upstream advisory range or
  the separate older glob path. Minimized reachability in inspected tooling
  does not establish a clean native binary.
- Cached identity verification retains the existing [token and key revocation
  limits](CACHED_JWKS_VERIFICATION.md). These routes still check current database
  ownership, but cached signature verification does not guarantee immediate
  sign-out or token revocation. This review does not change that policy.
- Native source changes require a new signed build and distribution before
  they reach installed iPhone/Android applications. A source merge alone does
  not update TestFlight or an installed app.
- Genuine signed-in fleet, email/passkey delivery, Safari/PWA and exact-build
  iPhone/Watch acceptance remain separate checks. Device camera transitions,
  alerts, interruptions, battery and heat cannot be certified by mocked tests.
- Existing default-off detector experiments, event retries and other release
  gates stay governed by the roadmap. This review makes no detection-accuracy
  or crash-prevention claim.
