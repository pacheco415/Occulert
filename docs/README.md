# Occulert documentation

Start with the [authoritative development roadmap](APP_ROADMAP.md). It records
shipped web behavior, the installed private-native baseline, current source,
validation gaps, and future work. Specialist documents below explain contracts
and procedures; dated audit/release notes are historical evidence.

- [Backend implementation and next steps](BACKEND_ROADMAP.md)
- [Detection evidence and future upgrades](FACIAL_RECOGNITION_ROADMAP.md)
- [Performance targets and validation](PERFORMANCE_ROADMAP.md)
- [Beta test and pilot evidence plan](BETA_TEST_PLAN.md)
- [Accuracy benchmark](ACCURACY_BENCHMARK.md)
- [One-page pilot overview](PILOT_OVERVIEW.md)
- [Pilot recruitment package: qualification and unsent emails](PILOT_OUTREACH.md)
- [Parked device readiness](PARKED_DEVICE_READINESS.md)
- [Safe stop handoff](SAFE_STOP_HANDOFF.md)
- [Protected fleet follow-ups](FLEET_FOLLOWUPS.md)
- [Fleet query indexes](FLEET_QUERY_PERFORMANCE.md)
- [Self-hosted MediaPipe runtime](MEDIAPIPE_RUNTIME.md)
- [Passwordless profile onboarding](PASSKEY_ONBOARDING.md)
- [Dated technical audit](AUDIT.md)
- [September 21 release evidence](RELEASE_2026-09-21.md)
- [September 21 source stabilization record](SOURCE_STABILIZATION_2026-09-21.md)

## Asset versions

`asset-versions.json` maps source names to immutable filenames. When editing an
immutable asset, use a new version suffix, update every reference (imports,
service-worker lists, Vercel headers, tests), and update `asset-integrity.json`.
Never publish different bytes at an existing immutable URL. Preserve older
deployed assets for clients holding older documents. `npm run audit:site`
verifies integrity, references, font preconnects, and extracted-page boundaries.
HTML, manifest.json, and sw.js always revalidate.
