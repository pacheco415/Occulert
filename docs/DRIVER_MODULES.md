# Driver module source and release

`src/driver-app.js` is the composition entry for eight domain modules:
`camera`, `detector`, `calibration`, `metrics`, `alerts`, `storage-history`,
`cloud-sync`, and `ui`. Edit these readable modules. Published versioned files
remain immutable. No detector experiment or threshold changes with this split.

The modules own their mutable state and expose explicit setters. The coordinator
runs local start/stop and cloud hooks in their existing order; accepted-alert
hooks run only after the original cooldown, calibration and confidence checks.
Application `start`/`stop` are readonly lexical aliases. The browser's own
`window.stop` remains available. Audio recovery listeners stay at the tested
alerts boundary; preference restore and final readiness are explicit entry phases.
A failed voice restore keeps voice actions uninitialized and fails before writes.

`npm run build` compiles the actual source graph into ignored `build/driver-app.js`
and a provenance receipt. Pinned esbuild creates a single classic-script compatible
output. The bounded build adapter restores real declaration kinds and runnable
excerpt boundaries required by existing tests. It proves source functions,
initializers, module evaluation and top-level effects, resolved local bindings,
UTF-8 serialization and executable marker ownership. Unsupported transformations
fail instead of silently altering behavior. No old driver implementation is a
build input, and no source map is emitted.

Run `npm run asset:release -- --dry-run`, inspect the plan, then run
`npm run asset:release`. This recompiles source in memory, copies changed outputs
and immutable importers, updates guard/worker integrity and chooses fresh URLs and
one cache name. Dependency bumps synchronize resource URLs and the helper pin in
actual modules, recompile their staged graph and verify the exact planned output
before committing any checkout files. The entry is never replaced with a bundle.
A no-op writes nothing. Local build files, sources, compiler configuration and
provenance are excluded from deployment and offline caching.

`lint:source` checks the nine sources for undefined globals, reassignment and other
ownership mistakes. `typecheck:source` checks detector and alerts with strict
JSDoc/nullability. Other modules remain JavaScript without a full typecheck claim.
`test:driver-build` exercises actual compiler/release invariants and rejected
mutations. Existing behavioral tests continue reading the real active output
selected by `asset-versions.json`; their files and harnesses are unchanged.
