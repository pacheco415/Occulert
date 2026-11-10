# Move versioned runtime output into a dedicated directory

Planning baseline: main `86ea67c11d11e6f581754f2be4c017956966b3db`, observed
October 28, 2026. This document implements task 5.9 from the October 25 list.
It authorizes no asset migration by itself. This PR adds only this plan; it
does not move, edit, delete or publish any runtime asset.

## Implementation status — October 28, 2026

Stage 1 landed in [PR #332](https://github.com/pacheco415/Occulert/pull/332):
bounded runtime paths, basename-based current-asset lookup and source-output
validation now share a tested contract. That change moved no assets.

The first remaining implementation is stage 2, `codex/asset-directory-release`:
directory-aware release, audit and retirement tooling with safe staging and
rollback. No live output should move before the later compatibility and pilot
stages. The counts below describe the original planning baseline.

## Baseline layout and constraints

The baseline has **127 root versioned JS/CSS files: 98 JavaScript and 29 CSS**.
`asset-versions.json` contains 74 logical entries pointing to 59 distinct
active outputs; aliases such as public page scripts share an output. The
integrity manifest has 128 entries, including retained output and other owned
assets. These counts supersede the task list's earlier count of 113 root files.
They are a source-tree observation, not a deployment receipt.

The worker cache is `occulert-v145`. `source-assets.json` registers the bundled
driver at `src/driver-app.js` and the copy-mode parked helper at
`src/detection-experiments.js`. Other logical outputs still use `asset:bump`.
Follow [SOURCE_ASSET_PLAN.md](SOURCE_ASSET_PLAN.md) when registering more source;
registration and output relocation are separate changes.

[RELEASING.md](../RELEASING.md) remains authoritative:

- Published bytes and URLs are immutable, including prepared URLs reserved by
  full Git history. A changed importer receives its own fresh version.
- Retain superseded output for at least 14 days and longer while a retained
  runtime consumer needs it. Retirement warns from day 14 and fails at day 21;
  migration must preserve the retirement clock and the weekly check.
- HTML, `manifest.json` and `/sw.js` revalidate. Runtime release updates the
  manifest, integrity, references, headers and worker cache together.
- Vercel serves committed, prebuilt files with an empty `buildCommand`.
  Editable source, internal build output and tooling stay excluded from public
  deployment and offline caching.

## Layout choices

| Option | Benefit | Cost and risk |
| --- | --- | --- |
| Commit new output under `assets/runtime/`, preserving each `.vNN.js` / `.vNN.css` basename | Public URL equals repository path; keeps existing prebuilt deployment and logical names; separates runtime output from source | Release, audit and retirement tools must understand both root and nested paths during migration |
| Emit an entire deployable site into `dist/` or `build/` | One deploy directory with a clean source root | Requires a new packaging/deployment contract for HTML, API routes, vendor files and retained URLs; `build/` is deliberately excluded today |
| Use content-hashed files or one directory per release | Content identity or release grouping is visible in paths | Changes version allocation, cache/reference contracts and retention accounting along with location; retains more duplicated output |

**Recommend `assets/runtime/` for new versioned JS/CSS releases.** Keep logical
keys such as `driver-app.js` stable. A manifest value becomes, for example,
`assets/runtime/driver-app.vNEXT.js`, where `vNEXT` is an illustration and the
release planner selects the actual unused number from current full history.
Manifest values and integrity keys remain repository-relative, without a
leading slash; served references use `/assets/runtime/...`.

Keep HTML, `/sw.js`, `manifest.json`, API routes, `vendor/`, audio and image URLs
where they are. `assets/runtime/` contains only tracked, versioned runtime
output, with no source maps, source files, arbitrary uploads or configuration.
Keep generated compiler staging under excluded `build/` or the existing
temporary release directory. This recommendation needs no CDN or new origin.

## Compatibility and the retention window

Migrate by **adding fresh releases**, not by renaming or deleting published
files. For the first pilot, leave `/driver-overview.v1.css` byte-for-byte intact
and add a fresh version under `assets/runtime/`. Change current references to
the new path in the same release. Every previously served root URL continues
to return its original bytes directly from its existing file throughout its
retention window. This includes URLs in cached older pages, old workers and
retained JS/CSS importers. No redirect or rewrite is needed for that window.

Do not redirect an old versioned URL to a newer version. The old page may have
SRI or an older dependency contract. Also avoid redirects even to a byte-equal
new location during this migration: direct files preserve the established
request URL, response behavior and cache identity. A future compatibility
rewrite would need separate deployed and offline evidence; it is not a
substitute for retained files in this plan.

Root and nested output may coexist for several releases. Keep integrity entries
and immutable header coverage for both. Reserve each stem's version numbers
across **both locations** and all known branches, including deleted and
merge-resolution-only files. Do not start a second `v1` series in the directory.
The directory is not a way to reuse a previously reserved basename.

Retire a root file only after the existing audit establishes at least 14 days
since its final relevant runtime reference was retired, and no retained
consumer still requires it. Preserve old dependencies transitively. The first
cleanup PR must show the eligible list, reference checks and original
retirement timestamps. If a compatibility issue appears, retain files and fix
the next release; never rewrite published bytes. Rollback revalidating entry
documents and the worker through a new release/cache identity, with all old and
new output still available.

## Required tool and policy changes

| Surface | Required change before switching any live output |
| --- | --- |
| `asset-versions.json` | Keep the logical-key schema and shared-output aliases. Accept only validated root output or `assets/runtime/<versioned-basename>` values. One alias family must move together. |
| `asset-integrity.json` | Key every root and nested served file by its full relative path. Hash actual bytes. Retain old entries until their files are eligible for retirement; verify all retained entries, not just current output. |
| `scripts/bump-asset.mjs` | Separate logical stem, basename, relative path and public URL. Allocate fresh names across both directories and full branch history. Expand root-only Git history pathspecs to cover the new directory. Build dependency replacements from complete paths rather than incidental basename substrings. Copy every affected active importer; never patch retained importers. Update HTML, worker lists, pins and aliases in one staged plan. Keep dry run/no-op behavior and guarded refresh. |
| `scripts/lib/source-assets.mjs` | Relax the current root-only active-output validator to the exact permitted directory shape, retaining traversal/symlink checks. Preserve source/output equality, bundle contract checks and helper/startup SRI synchronization. Create the owned output directory safely as part of release staging; current `commitAssetPlan` rejects missing target parents. Rollback must restore prior files and remove only directories the operation created. |
| `scripts/lib/current-assets.mjs` | Keep returning full manifest paths. Fix `assetByStem`: its current regexp treats a directory prefix as part of the logical stem. Compare the validated basename to the requested logical stem, then return the unique full path; preserve shared-alias deduplication and ambiguity failures. |
| `scripts/audit-assets.mjs`, `scripts/audit-site.mjs`, `scripts/audit-asset-sizes.mjs` | Validate allowed nested output and retained integrity, public header coverage and resolved dependencies. Replace root-only enumeration and the size audit's blanket slash rejection with bounded safe-path handling. Keep root-output checks during coexistence and reject unversioned files in the runtime directory. Resolve CSS imports against the stylesheet URL when they are relative. |
| `scripts/audit-asset-lineage.mjs` | Its versioned-path regexp already accepts nested paths. Extend fixture coverage for root-to-directory transitions, stale logical releases and cross-directory basename reservations; do not remove existing immutable-collision checks. |
| `scripts/lib/retired-assets.mjs`, `scripts/retire-assets.mjs` | Replace root-only file/dependency enumeration and history pathspecs with an explicit root-plus-runtime inventory. Preserve dependency reachability, last-reference dates and the 14/21-day policy. Recognize both locations when pruning headers, integrity and exact-name fixtures. Keep dry-run/check/write separation and never rewrite runtime references to make a file eligible. |
| `scripts/serve-static.mjs` and deployment checks | The local server already resolves nested files inside the repository and applies ordered headers. Verify direct nested requests and traversal/symlink rejection; do not add a catch-all fallback. The current server only models external rewrites, another reason not to depend on compatibility rewrites. Validate Vercel preview responses too. |

Avoid a global search-and-replace of a basename: it can leave a doubled
directory prefix or alter a retained runtime file. A shared, tested asset-path
helper should make the allowed locations and normalization explicit. Reject
absolute filesystem paths, URLs, `..`, encoded traversal, backslashes and
symlink escape paths. Continue excluding native, vendor, fixtures, source and
unrelated directories from release scanning.

## Service worker, URLs and browser policy

Keep the worker at `/sw.js` so registration and scope remain unchanged. For each
actual relocation release, update the relevant `STATIC_ASSETS`,
`CRITICAL_OFFLINE_ASSETS`, `STARTUP_GUARD_ASSETS`, `EXPERIMENT_HELPER_ASSETS`,
`NETWORK_FIRST_ASSETS` and `NETWORK_ONLY_ASSETS` entries in `sw.js`. Its optional
path set and runtime-integrity map derive from these lists; use exact new paths
and correct SRI. Preserve each asset's cache category. A new directory does not
make a protected script eligible for static caching, nor make the parked helper
part of the default install. Keep retained protected root URLs network-only
for as long as they are served.

Advance `CACHE` once for the whole composed release, beyond every recorded
cache version. Test installation with the preceding worker and cached page,
activation/cache cleanup, online-to-offline reload and partial/corrupt responses.
Old cached pages must still load their retained URLs against the new deployment.
Do not delete old files just because the newest worker no longer installs them.

The driver startup guard embeds a driver `corePath`, and the driver source
dynamically selects the parked helper URL and integrity. Moving one of these
requires the normal importer/guard release chain and pins, not only a manifest
edit. Audit JS fetches, worker creation and dynamic script URLs. Resolve every
relative JS/CSS resource against its real browser base. For example, current
`homepage.v51.css` imports `/base.v47.css` and uses root-absolute image URLs,
while `inter-fonts.v2.css` uses `/vendor/inter-5.3.0/...`; those URLs remain
valid when their stylesheet moves. A newly relative URL could instead resolve
under `/assets/runtime/`, so moving without checking bytes is unsafe.

Keep the general JS/CSS revalidation header and add narrowly owned nested
immutable rules **after** it in `vercel.json`, preserving existing root rules
until the last matching retained file is removed. Existing per-version
`/(.*)\\.vNN\\.(js|css)` rules can match nested paths; compute the effective
last matching header instead of assuming location implies coverage. Require
`public, max-age=31536000, immutable` for both old and new output, correct MIME
types and unchanged revalidation for entry documents and the worker.

Same-origin `/assets/runtime/` is already covered by the CSP's `'self'` script
and style policy. Preserve the strict `/app.html` overrides, exact Supabase
connection host, WASM policy, external-only scripts and all existing SRI checks.
No wildcard origin, inline-script allowance, eval allowance or extra CDN grant
is needed. Run `scripts/test-csp-policy.mjs` and the strict startup/browser
cases to prove the resulting headers and runtime behavior.

Keep `.vercelignore` exclusions for `src/`, `build/`, scripts, fixtures and
configuration. Include only versioned runtime files in the new public directory;
the explicit empty Vercel `buildCommand` stays in place. Confirm preview output
contains the new files but excludes source, temporary release staging and source
maps. This plan does not switch to deployment-time compilation.

## Small migration PRs

Estimates are engineering effort excluding hosted-check queues and the mandatory
retention wait. Each PR starts from current main and records its exact baseline.

| Order | PR and scope | Completion evidence | Effort / main risk |
| --- | --- | --- | --- |
| 1 | **`codex/asset-path-contract`: add bounded runtime asset-path helpers and fixture coverage; keep all manifest values and served URLs unchanged.** Teach `current-assets` and source-output validation the two supported locations through the shared contract. | Root-only site remains byte-identical; root/nested/alias/invalid-path fixtures pass; full verification. This is the first implementation PR. | 1 day; accidentally broadening accepted paths or confusing logical stems with output paths |
| 2 | `codex/asset-directory-release`: make bump/source release, audits, lineage and retirement use that contract. Add safe directory staging/rollback and history allocation across locations. No live output moves. | Synthetic root-to-directory releases, prepared/deleted/merge-only reservations, aliases, importer propagation, failed-write rollback, dry-run/no-op and retirement fixtures pass; all current runtime bytes/manifests remain unchanged. | 2–3 days; gaps between tool discovery, version allocation and retirement |
| 3 | `codex/asset-directory-compatibility`: extend server/header/cache/browser fixtures for root-plus-directory coexistence, old-page upgrade, protected cache exclusion and strict CSP/SRI. Add prospective scoped header support without repointing current assets. | Both URL forms serve exact fixture bytes with effective headers; old worker/page upgrade and offline cases pass in Chromium and WebKit; preview exclusions verified. | 1–2 days; local-server evidence diverging from deployed behavior |
| 4 | `codex/asset-directory-pilot`: release only `driver-overview.css` into the directory using a freshly allocated version, keep its CSS bytes equal, and update its current HTML/worker references in the normal release. Retain root `driver-overview.v1.css`. | Old/new body and digest comparisons, current overview layout/accessibility, old-page fetch and offline upgrade, cache/header checks; no other logical asset moves unless required importer composition is explained. | 0.5–1 day; first production path/cache interaction |
| 5 | `codex/asset-directory-<family>`: migrate one reviewed logical family per fresh release, starting with simple styles before backend or driver/guard/helper chains. Preserve alias groups and retained imports. | Per-family reference/dependency table, affected behavior/browser checks, retained-URL receipts and full release verification. | 0.5–2 days per family; dynamic or relative references, importer fan-out |
| 6 | `codex/retire-root-output-<date>`: after the applicable retention windows, use the updated retirement tool to remove only eligible root files and exact obsolete bookkeeping/fixtures. | Dry-run list and timestamps, transitive-reference audit, retained-URL checks and resulting-main verification. | 0.5 day per batch after at least 14 days; prematurely removing a dependency |

Do not combine source registration for the backend, shared-session-state
refactoring or detection changes with relocation. New source registrations can
continue separately under the existing source plan once the path contract is
ready. Refresh the pilot choice if current main has changed its dependencies.

## Validation and decision gates

Implementation PRs must keep the existing tests and add relocation-specific
coverage to `scripts/test-bump-asset.mjs`, `scripts/test-source-release.mjs`,
`scripts/test-bundled-source-release.mjs`, `scripts/test-asset-lineage.mjs` and
`scripts/test-retire-assets.mjs`. Include root/nested active and retained files,
alias families, CSS relative URLs, nested importers, missing parents,
path/symlink rejection, history collisions and exact retirement boundaries.
Use temporary fixture repositories; do not manufacture a release in the real
checkout merely to test the plan.

Extend `tests/asset-cache.spec.mjs` to cover a captured retained root cohort as
well as current manifest output, checking response bytes, SRI digest and the
effective immutable headers. Reuse `tests/service-worker.spec.mjs`,
`tests/driver-startup-recovery.spec.mjs` and the offline diagnostics helpers for
worker update, cache corruption, startup recovery and optional-helper behavior.
Test both browsers, including an old-page snapshot against the new deployment;
ordinary tests reading only the newest manifest cannot prove compatibility.

For every runtime/tool implementation: use Node 24, run clean `npm ci` and
`npm run verify`, the affected browser suites and required hosted PR checks.
For runtime releases, inspect dry-run and generated diffs, verify every
previously served retained path against its original bytes, and record preview
HTTP/header and offline results. Merge only after required checks pass and
confirm the release-guide checks on the resulting main commit. Record actual
deployment receipts separately; a local static-server pass is not one.

The migration is complete when active JS/CSS output is under `assets/runtime/`,
no served runtime consumer requires an eligible root output, all old files have
passed their individual retention checks, and audits/release/retirement tools
work without root-location assumptions. Revalidate counts at that point. This
planning PR makes none of those completion or deployment claims.
