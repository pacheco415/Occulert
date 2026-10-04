# Releasing Occulert

1. Start each change from the latest `main` and use a pull request. Use Node 24.
   Never put `[skip ci]` or `[ci skip]` in a PR title or commit message.
2. When changing a versioned `.js` or `.css` asset, copy it to a new versioned
   filename and edit the new file. Published asset bytes are immutable. Update
   the page's HTML and any runtime imports to reference the new filename.
3. Point the logical entry in `asset-versions.json` to the new file. Add its
   SHA-256 hex digest to `asset-integrity.json` (for example, obtain it with
   `shasum -a 256 path/to/asset.v69.js`). Keep integrity entries for old files
   that are still served.
4. Update the relevant asset list in `sw.js` and advance its `CACHE` name so
   browsers install the new assets. Keep sensitive scripts in
   `NETWORK_ONLY_ASSETS`; check the static cache size before adding files to
   `STATIC_ASSETS`.
5. Add or extend the new version's `vercel.json` header rule so versioned URLs
   receive `Cache-Control: public, max-age=31536000, immutable`. Leave HTML and
   `sw.js` revalidating. The immutable rule must
   follow the general `.js`/`.css` rule because the last matching rule wins.
6. Run `npm ci` and `npm run verify` with Node 24. Record the pass/fail summary
   in the PR. Merge only when Site Audit, Browser Smoke Tests, and Native App
   Typecheck are all green on that PR; confirm they ran on the resulting `main`
   commit too.

Keep superseded assets for at least 14 days so cached older pages can still
load. After that grace period, remove a file only after checking references in
HTML, runtime JS, `sw.js`, `asset-versions.json`, `asset-integrity.json`, and
`vercel.json`, including references without a leading slash. Remove its stale
integrity entry, service worker entries, and test fixtures; remove a Vercel
rule only if no retained asset needs it. Bump `CACHE` again.

For releases with database migrations, apply the migrations in timestamp order
before deploying routes or clients that use the new schema or functions.

Use `npm run asset:bump -- <logical-name> --dry-run` to review an asset release plan, then run without `--dry-run` to copy the asset and any active versioned importers, rewrite page references, update manifests and cache lists, and add immutable headers. Edit the new file, then use `npm run asset:bump -- <logical-name> --refresh` before committing to refresh its integrity digest. Refresh rejects assets already active in HEAD. Review the plan and run all release verification before committing or publishing.

### Editable source pilot

`source-assets.json` currently registers `driver-app.js` in bundle mode, built
from `src/driver-app.js` and its eight domain modules. Edit the actual source,
then review `npm run asset:release -- --dry-run` and run `npm run asset:release`.
Release processes every changed registered source in one plan, copies its
versioned importers, synchronizes
guard/helper pins, and advances the aggregate cache once. An unchanged source
is an exact no-op; it does not reserve another URL or cache name. Fetch and
integrate `origin/main` first. Finish or discard an existing unpublished release
before starting another source release.

`npm run audit:source-assets` compares each registered source with its active
immutable output. Driver bundle mode compiles the actual graph with pinned
esbuild and checks source, binding and effect identity before release. Existing
bumps of an unregistered dependency synchronize URL and integrity references in
the real registered source and recompile before writing. Pending source edits
block those bumps, so the tool cannot discard them. Copy mode remains supported
for classic UTF-8 JS or CSS; neither mode emits source maps. Other logical assets
still use the existing bump workflow. The migration plan and coverage boundary
are in [docs/SOURCE_ASSET_PLAN.md](docs/SOURCE_ASSET_PLAN.md) and
[docs/DRIVER_MODULES.md](docs/DRIVER_MODULES.md).

Local and CI verification runs `npm run build` and checks the compiled driver
against its committed runtime. Vercel uses the Other preset with an explicit empty `buildCommand` in `vercel.json` to serve
prebuilt assets; it must not auto-run the excluded compiler. Keep source,
scripts, configuration and internal build output excluded from deployment and
offline caching. Validation and output staging happen before replacements; a
failed replacement restores prior files. Keep the checkout idle while releasing,
review the generated diff, and run all verification before committing.

### Prepared branch asset names

Before choosing a new asset URL, fetch the current main and relevant remote branches into a full-history checkout. The release tool reserves filenames found anywhere in known Git history, including other local/remote-tracking branches and deleted files. It includes merge diffs so filenames and cache names first introduced during conflict resolution stay reserved after removal. It also advances the service-worker cache beyond every recorded cache version in known history, so two prepared releases cannot share a cache identity. It does not contact GitHub automatically or know branches that have never been fetched. Never reuse an immutable URL from another prepared release, even after its file is deleted.

The PR Site Audit checks the actual PR head against the base revision with
`scripts/audit-asset-lineage.mjs`. A stale logical release or an immutable filename
collision blocks the PR. Rebase onto current main, copy its current active asset
to a fresh version, and apply only the intended feature diff. Review the composed
source; the lineage check cannot prove that all earlier behavior was preserved.
Never resolve release manifests or service-worker lists by selecting one side.

All HTML scripts must be external and owned; inline bodies and `on*` attributes
are forbidden, including generated controls. The deferred startup guard runs before the deferred driver and is
pinned by SRI in HTML and the integrity-verified critical offline list. Its readiness handshake also accepts
a driver's previously completed frozen capability and rejects startup
that has exceeded its deadline. The asset tool copies versioned importers and
refreshes guard pins when a driver release changes the referenced core path.
Run strict policy/startup and normal browser cases after changing that contract.

The optional parked detection helper is pinned by its versioned driver importer
and optional worker entry. Bumping `detection-experiments.js` also copies the
driver and startup guard; refreshing that unpublished helper synchronizes its
SRI and importer digest. The tool rejects rewriting a published importer. Keep
these optional bytes outside the default installation cache and run the helper
release, strict offline, and trace adapter checks after a helper change.

CSP connections use the exact project host declared in
`scripts/lib/csp-policy.mjs`. If the backend project changes, update that constant
and all Vercel connection policies together and verify `/api/public-config`.
Retained old SDK loaders require their documented CDN compatibility grant during
the existing 14-day retention window; remove it after the reference audit passes.

The driver now uses the bundled source mode described in
[docs/DRIVER_MODULES.md](docs/DRIVER_MODULES.md). Edit its eight modules and entry,
then release through `asset:release`; do not copy compiled output into the entry.
Other logical assets retain the existing manual immutable release process.

### Weekly retired asset cleanup

Run `npm run asset:retire` in a full-history checkout to review eligible files,
then `npm run asset:retire -- --write` on a dedicated branch. The tool shares
the audit's retirement dates and protects HTML, service-worker, manifest and
active asset roots, plus every dependency of a retained runtime file. It never
rewrites a runtime reference to make a file eligible. An asset in `sw.js` remains
protected; review and release any obsolete runtime references separately first.

Removal starts at 14 days after retirement. The audit warns from day 14 through
day 20 and fails at day 21. Run cleanup weekly so the warning window does not
expire. Write mode drops integrity entries, unused immutable Vercel version
rules and unreferenced exact-name asset fixtures, and advances CACHE once beyond
all recorded cache versions. Review tests that use fixtures with other names
(the tool preserves these), run full verification, and follow the normal PR
checks before merge. An empty cleanup does not change files or CACHE.
