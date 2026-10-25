# Static asset measurements

Run `npm run audit:asset-sizes` with Node 24. The check resolves current published assets through asset-versions.json, reports raw/gzip/Brotli bytes, and fails when selected raw byte ceilings are exceeded. Compression figures are local measurements, not a promise about server transfer encoding.

Initial review ceilings: driver logic 90 KB, backend client 33 KB, driver styles 20 KB, fleet dashboard HTML 100 KB, and monitor HTML 30 KB. These are explicit review limits with growth headroom, not measured latency or clinical accuracy targets. Change a ceiling deliberately in a reviewed PR after measuring the new release. On 2026-10-21 the backend client ceiling moved from 33 KB to 35 KB for email-link confirmation (occulert-backend.v82.js, 34,533 bytes). The October 22 follow-up raises it to 36 KB for exact-session guards and refresh preparation (occulert-backend.v83.js, 35,611 bytes); see [EMAIL_LINK_CONFIRMATION.md](EMAIL_LINK_CONFIRMATION.md). Keep immutable asset release rules intact.

On October 25, the backend ceiling moves to 38 KB for bounded server sign-out
and captured-session refresh/revocation. The new `occulert-backend.v86.js`
measures 37,353 raw bytes, 8,957 gzip bytes and 7,698 Brotli bytes, compared with
35,940 / 8,657 / 7,445 for v84. The 1,413-byte raw increase implements session
revocation without blocking local sign-out or writing refreshed credentials.

The selected set covers frequently loaded first-party entry assets. It does not represent the complete request waterfall, MediaPipe/WASM/model sizes, real-device heat or battery use. Existing startup and browser checks test behavior; physical-device startup measurements remain separate evidence.
