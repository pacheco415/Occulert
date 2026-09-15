# Occulert documentation

- [App Roadmap](APP_ROADMAP.md)
- [Backend Roadmap](BACKEND_ROADMAP.md)
- [Facial Recognition Roadmap](FACIAL_RECOGNITION_ROADMAP.md)
- [Performance Roadmap](PERFORMANCE_ROADMAP.md)
- [Beta Test Plan](BETA_TEST_PLAN.md)
- [Safe Stop Handoff](SAFE_STOP_HANDOFF.md)
- [Pilot Outreach](PILOT_OUTREACH.md)
- [Accuracy Benchmark](ACCURACY_BENCHMARK.md)
- [Audit](AUDIT.md)

## Asset versions

`asset-versions.json` maps source names to immutable filenames. When editing an immutable asset, give it a new version suffix, update every reference (including imports, service-worker lists, Vercel header rules and tests), and update `asset-integrity.json`. Never publish different bytes at an existing immutable URL. Keep older deployed assets available when supporting clients still holding old documents. `npm run audit:site` verifies asset integrity, references, font preconnects and extracted-page boundaries. HTML, manifest.json and sw.js always revalidate.
