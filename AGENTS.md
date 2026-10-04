# Coding instructions

- Start from current main. Keep one task per branch named `codex/<short-topic>`.
- Use Node 24 from `.nvmrc`.
- Run `npm ci && npm run verify` for site or API changes.
- Run `cd native-app && npm ci --include=dev && npm run verify` for native changes.
- Report validation results in each pull request.
- Never add CI skip instructions to commit messages or pull request titles.
- Follow [RELEASING.md](RELEASING.md) for every versioned JS or CSS change.
- Never edit published versioned assets; copy to the next available version.
- Update HTML/runtime references, `asset-versions.json`, SHA-256 entries in
  `asset-integrity.json`, service worker lists and its cache name.
- Put immutable asset headers after the general JS/CSS header in `vercel.json`.
- Keep superseded assets for the release guide's retention window.
- Add database changes to `supabase/migrations/<timestamp>_<name>.sql`.
- Enable RLS on new tables and add meaningful PGlite database regressions.
- Apply required migrations before deploying code that depends on them.
- Derive server identity from verified bearer tokens; ignore client claims of
  owner, driver or fleet authority. Keep service-role credentials server-only.
- Exclude coordinates, personal media and raw motion from protected fleet views.
- Preserve consent and account boundaries during asynchronous operations.
- Keep detection experiments behind flags until benchmark evidence supports them.
- Merge only after required checks pass; follow the release guide's main checks.

Read [BACKEND_SETUP.md](BACKEND_SETUP.md) for backend configuration and
[docs/APP_ROADMAP.md](docs/APP_ROADMAP.md) for product scope and validation gates.
