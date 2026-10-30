# Static asset measurements

Run `npm run audit:asset-sizes` with Node 24. The check resolves current published assets through asset-versions.json, reports raw/gzip/Brotli bytes, and fails when selected raw byte ceilings are exceeded. Compression figures are local measurements, not a promise about server transfer encoding.

Initial review ceilings: driver logic 90 KB, backend client 33 KB, driver styles 20 KB, fleet dashboard HTML 100 KB, and monitor HTML 30 KB. These are explicit review limits with growth headroom, not measured latency or clinical accuracy targets. Change a ceiling deliberately in a reviewed PR after measuring the new release. On 2026-10-21 the backend client ceiling moved from 33 KB to 35 KB for email-link confirmation (occulert-backend.v82.js, 34,533 bytes). The October 22 follow-up raises it to 36 KB for exact-session guards and refresh preparation (occulert-backend.v83.js, 35,611 bytes); see [EMAIL_LINK_CONFIRMATION.md](EMAIL_LINK_CONFIRMATION.md). Keep immutable asset release rules intact.

On October 25, the backend ceiling moves to 38 KB for bounded server sign-out
and captured-session refresh/revocation. The new `occulert-backend.v86.js`
measures 37,353 raw bytes, 8,957 gzip bytes and 7,698 Brotli bytes, compared with
35,940 / 8,657 / 7,445 for v84. The 1,413-byte raw increase implements session
revocation without blocking local sign-out or writing refreshed credentials.

The single-flight refresh release raises it to 40 KB. `occulert-backend.v87.js`
measures 39,084 raw bytes and 9,431 gzip bytes. The 1,731-byte raw increase
shares one refresh per refresh token in a tab, refreshes 60 seconds before
expiry and serializes refreshes across tabs with a Web Lock.

The lock-wait race follow-up publishes `occulert-backend.v88.js`: 39,558 raw
bytes, 9,565 gzip bytes and 8,244 Brotli bytes, still within the 40 KB ceiling.
The additional local-action generation preserves a newer sign-in or sign-out
while an older refresh waits for its Web Lock, while allowing queued callers
to reuse an internal token rotation.

The keyed event transport prerequisite publishes `occulert-backend.v90.js` at
46,733 raw / 11,163 gzip / 9,621 Brotli bytes, compared with
40,714 / 9,819 / 8,468 for v89. Its 6,019 raw / 1,344 gzip / 1,153 Brotli byte
increase adds the exact public capability gate, validated immutable event
payload, one-attempt guarded sender, bounded Retry-After metadata and local Auth
lifecycle signal. The reviewed raw ceiling moves from 41,000 to 48,000 bytes.
Both versions remain network-only, the existing event sender is unchanged and
the outbox adapter remains disabled. These are local compressed measurements;
they do not establish network latency or real-device startup performance.

The selected set covers frequently loaded first-party entry assets. It does not represent the complete request waterfall, MediaPipe/WASM/model sizes, real-device heat or battery use. Existing startup and browser checks test behavior; physical-device startup measurements remain separate evidence.

The gated web event adapter raises only the driver ceiling from 95 KB to 125 KB.
`driver-app.v99.js` measures 120,762 raw bytes, 33,927 gzip bytes and 28,340 Brotli
bytes, compared with 94,419 / 26,805 / 22,625 for v98: increases of 26,343 raw,
7,122 gzip and 5,715 Brotli bytes. The measured increase contains the actual shared
TypeScript delivery engine, bounded storage and lifecycle adapter, cross-tab
ownership and pending/discard counters. Feature flags default off; the larger
compiled artifact does not itself enable retries. Other per-asset ceilings are
unchanged. Selected `STATIC_ASSETS` install bytes increase from 341,629 to 368,055
(+26,426, including the new status element in HTML). Their separate review ceiling
moves from 342 KB to 375 KB, which also accommodates the 125 KB driver ceiling.
This selected total excludes separately budgeted runtime/model resources. These
are local compression measurements, not device
startup, network latency or operational rollout evidence.
