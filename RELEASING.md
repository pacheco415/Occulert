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
