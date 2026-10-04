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

CSP connections use the exact project host declared in
`scripts/lib/csp-policy.mjs`. If the backend project changes, update that constant
and all Vercel connection policies together and verify `/api/public-config`.
Retained old SDK loaders require their documented CDN compatibility grant during
the existing 14-day retention window; remove it after the reference audit passes.
