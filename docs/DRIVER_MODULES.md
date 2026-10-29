# Driver module source and release

`src/driver-app.js` is the composition entry for nine domain modules:
`camera`, `detector`, `calibration`, `metrics`, `alerts`, `storage-history`,
`cloud-sync`, `event-outbox-adapter`, and `ui`. The adapter imports the sole shared
delivery engine at `lib/event-outbox.ts`. Edit these readable sources. Published
versioned files remain immutable. No detector experiment or threshold changes
with this integration.

The modules own their mutable state and expose explicit setters. The coordinator
runs local start/stop and cloud hooks in their existing order; accepted-alert
hooks run only after the original cooldown, calibration and confidence checks.
Application `start`/`stop` are readonly lexical aliases. The browser's own
`window.stop` remains available. Audio recovery listeners stay at the tested
alerts boundary; preference restore and final readiness are explicit entry phases.
Unavailable browser storage restores standard brightness, medium sensitivity,
and voice off. The UI-owned preference helpers catch both storage property and
method failures, return null/false, and show one parked settings note. Changes
remain active for this page even when they cannot be saved; calibration reapplies
the current sensitivity. The driver identity bootstrap also uses the safe helper
so a missing persisted identity does not block readiness. Session-history storage
and its existing failure reporting remain unchanged. Partial startup still
keeps voice actions uninitialized until the entry restores their preference.

`npm run build` compiles the actual source graph into ignored `build/driver-app.js`
and a provenance receipt. Pinned esbuild creates a single classic-script compatible
output. The bounded build adapter restores real declaration kinds and runnable
excerpt boundaries required by existing tests. It proves source functions,
initializers, module evaluation and top-level effects, resolved local bindings,
UTF-8 serialization and executable marker ownership. Contract, dependency lock and
module inputs must be regular owned files; linked configuration is rejected before
normal or staged builds read it. Excerpt boundaries move only actual hoisted
function declarations, while startup effects retain their source order. Unsupported transformations
fail instead of silently altering behavior. No old driver implementation is a
build input, and no source map is emitted.

The exact shared-input allowlist contains only `lib/event-outbox.ts`, imported as
named, non-aliased exports through `../lib/event-outbox.ts`. No arbitrary external
input, dynamic import, CommonJS dependency, re-export or erased type-only dependency
is accepted. Node 24 strips only erasable TypeScript for the Acorn binding and
effect proofs; esbuild compiles the actual raw TypeScript bytes. Provenance records
both raw and erased digests, the stripping implementation/version and the exact
compiler input list. Shared source must be a regular owned file. Staged overrides
retain sibling `src/` and `lib/` directories, copy the validated shared bytes, and
prove the same output before a release mutates files. Development `lib/` content
and TypeScript must remain outside deployed and cached assets.

Run `npm run asset:release -- --dry-run`, inspect the plan, then run
`npm run asset:release`. This recompiles source in memory, copies changed outputs
and immutable importers, updates guard/worker integrity and chooses fresh URLs and
one cache name. Dependency bumps synchronize resource URLs and the helper pin in
actual modules, recompile their staged graph and verify the exact planned output
before committing any checkout files. The entry is never replaced with a bundle.
A no-op writes nothing. Local build files, sources, compiler configuration and
provenance are excluded from deployment and offline caching.

`lint:source` checks the ten JavaScript sources for undefined globals, reassignment and other
ownership mistakes. `typecheck:source` checks detector and alerts with strict
JSDoc/nullability. `test:event-outbox` separately typechecks the shared TypeScript
engine. Other modules remain JavaScript without a full typecheck claim.
`test:driver-build` exercises actual compiler/release invariants and rejected
mutations. Existing behavioral tests continue reading the real active output
selected by `asset-versions.json`; their files and harnesses are unchanged.
