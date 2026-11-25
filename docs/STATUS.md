# Occulert status

These are dated snapshots. Source, deployment, build availability and device tests are separate.

- Inspected source (origin/main): `1ceb40c8ae320e54b560a1f07cabe1cbc1ddce9f`.
- Source commit date: 2026-11-24T16:40:34-08:00.

- Production website: Deployment receipts are kept private; no current receipt is published here.

- Internal TestFlight dashboard: 1.0.0 (62) showed Testing in the assigned group on 2026-11-14 (Pacific).
- TestFlight source: `bf7abe0bce2db34947b2f59f4989c3f1457266e8`.
- Upload marked Complete on 2026-11-14 (Pacific). [Delivery handoff](RELEASE_2026-11-23.md)
- Current Apple availability, replacement upload and remote build counter: Not checked.
- Physical acceptance for build 62: Not recorded.
- Native changes waiting for a build: 54 files differ from the TestFlight source.
  - native-app/app/\_layout.tsx
  - native-app/app/index.tsx
  - native-app/app/settings.tsx
  - native-app/components/history/HistoryFilters.tsx
  - native-app/components/history/HistorySessionCard.tsx
  - 49 more; inspect the source comparison before preparing a binary.

- Open PRs (2026-11-25T00:43:56.020Z): 0 total; 0 Codex, 0 Dependabot, 0 other; 0 draft.
- Production migrations: Operational receipts are kept private; no ledger or access-control details are published here.

Next steps:

1. Verify candidate changes against current main before release.
2. Review the native release intent and exact-build device checklist for the inspected source; a build remains a separate action.
3. Record parked iPhone Silent-mode Safari/PWA alerts, Watch delivery and exact-build device checks.
4. Keep production receipts private; verify deployment prerequisites before enabling dependent features.
5. Review remaining security and consent changes, then benchmark parked detector flags before changing released alerts.

Refresh the Git facts with `npm run status -- --write` in a current full-history checkout.
Supply only approved public snapshots in `docs/status-observations.json` and a complete PR snapshot in
`docs/status-pull-requests.json`; optional `--observations FILE`, `--pull-requests FILE` and `--ref REF` override them.
The tool performs no network requests, deployments, builds, database changes or external writes.
See [product scope and evidence rules](APP_ROADMAP.md) and [earlier records](archive/APP_ROADMAP_2026-09-28.md).
