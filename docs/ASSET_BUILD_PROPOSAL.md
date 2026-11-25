# Proposal for content-hashed site assets

Keep editable JavaScript, CSS, source registries and release rules in Git. On each deploy, build an isolated output directory containing the site's public files, immutable content-addressed assets and a release manifest. This changes the current Vercel contract, which serves prebuilt files from the repository root with an empty build command. Adoption requires a storage and retention decision before the first production cutover.

## Build and publish

1. Resolve a single tagged source revision and install from the lockfile using Node 24. Use the existing esbuild driver entry point, source contracts, copy-mode registry and pinned third-party inputs. Assign an editable source and build method to every remaining logical asset before removing its root copy.
2. Emit into staging, for example `dist/assets/driver-app.<sha256>.js`. Compile leaves first, rewrite importers to their final dependency URLs and SRI values, then hash the final bytes of each importer. A dependency change must change its importer. Fail on unhandled dynamic references or cycles. For a cycle, bundle the component or remove the cycle before migration. Put the human-readable app version in a source-derived build stamp so no file has to embed its own content hash.
3. Generate a logical-name-to-URL manifest and `asset-integrity.json` together. Record full SHA-256 in hex for the release ledger and Base64 for SRI, both derived from the exact emitted bytes. Verify every HTML tag, runtime importer, optional loader and worker pin after final HTML rewriting. Never rewrite a previously published content URL.
4. Generate the worker at its stable `/sw.js` URL. Derive its cache name from the final release manifest and cache policy inputs. Preserve the separate critical, optional, static and network-only lists, the startup handshake, offline fallback and install size limits. Protected account, billing and fleet scripts keep their network-only treatment. Old workers and new pages may coexist during rollout.
5. Publish blobs and the retention manifest first. Verify size, digest, content type and public readability of every referenced blob. Promote the HTML and worker together only after those reads succeed. A failed upload leaves the last promoted release intact. Make promotion conditional on the expected previous release to prevent concurrent deploys from overwriting a newer retention ledger.

## Vercel routing and caching

Replace the empty build command and root serving with a tested static output route. Keep the existing serverless API routing, headers and exclusions. The output directory must not expose source trees, SQL, tests, build tools, secrets or server handlers as static files. Preserve redirects, CSP, CORS, MIME types and the static site's existing canonical URLs.

Place a narrow immutable rule for generated content-hash paths after the general JS/CSS rule in `vercel.json`. Serve these verified paths for one year with `immutable`. Keep HTML, stable manifests and the worker revalidating. Preserve existing immutable headers for retained legacy URLs. A missing digest must return 404, never the HTML fallback. Verify headers on the production alias and a protected preview.

## Retention for installed PWAs

A URL available only in an old Vercel deployment is insufficient. Installed workers request old absolute paths on the current origin. Use a durable, append-only blob store behind the same-origin asset path, or restore a verified retention bundle into **every** deployment. The durable store is preferable when the carried bundle would approach the hosting size budget. Confirm the retention backend, operating cost, rollback owner and lifecycle policy before cutover.

Record the last release that references each asset, retirement time and transitively reachable dependencies. Keep the complete active graph and rollback release. Preserve retired graphs for at least the existing 14-day window measured from retirement, extending retention for known pinned releases. Do not depend on browser caches, access logs alone or garbage collection at build time. Serve original root versioned URLs with their original bytes throughout the compatibility window. Old installations returning later may need to update online. Test that recovery path explicitly.

Rollback republishes a retained HTML/worker release after verifying its entire graph. Use a fresh worker cache identity when changing the promoted worker. Retain both sides of the rollback. Delete only after the grace period, the reachability check and a successful restore drill.

## Migration and acceptance

| Phase | Change | Exit condition |
| --- | --- | --- |
| Inventory | Map source, generated importer, current URL, integrity, headers and worker classification for every logical entry. Catalogue retained legacy assets separately. | The generated inventory explains every served versioned file, including protected dependencies and historical fixtures. |
| Shadow build | Generate the output in CI alongside today's root artifacts. Compare source contracts, final bytes where comparable, importer graphs, SRI and deployment exclusions. Run the build twice in independent directories. | Reproducible paths and bytes, full site checks, no extra offline or public files. |
| Protected preview | Serve the new layout on one preview. Exercise clean install, cached legacy clients, old and new tabs, offline startup, optional imports, sign-out, interrupted activation and a rollback. | Both browser engines pass; same-origin legacy URLs and hash URLs return expected digests and headers. Test a parked physical Safari/PWA update. |
| Dual serving | Publish the retained legacy bundle and new hashes first. Switch only selected pages, then the driver startup chain and worker after exact-revision validation. | Installed clients survive two successive releases and a rollback. Observe asset 404s, worker install failures and storage growth against agreed thresholds. |
| Retire root copies | Stop committing new root versions once every importer is migrated. Continue serving old URLs from the verified store. Run weekly ledger-based retirement in dry-run mode before any removal. | The current graph is complete, the grace period has elapsed, restore succeeds and no retained release depends on removed bytes. |

Keep the existing release process available through the dual-serving phase. Changing deployment settings, activating storage and removing root files are separate implementation decisions.
