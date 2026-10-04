# Static asset measurements

Run `npm run audit:asset-sizes` with Node 24. The check resolves current published assets through asset-versions.json, reports raw/gzip/Brotli bytes, and fails when selected raw byte ceilings are exceeded. Compression figures are local measurements, not a promise about server transfer encoding.

Initial review ceilings: driver logic 90 KB, backend client 33 KB, driver styles 20 KB, fleet dashboard HTML 100 KB, and monitor HTML 30 KB. These are explicit review limits with growth headroom, not measured latency or clinical accuracy targets. Change a ceiling deliberately in a reviewed PR after measuring the new release. Keep immutable asset release rules intact.

The selected set covers frequently loaded first-party entry assets. It does not represent the complete request waterfall, MediaPipe/WASM/model sizes, real-device heat or battery use. Existing startup and browser checks test behavior; physical-device startup measurements remain separate evidence.
