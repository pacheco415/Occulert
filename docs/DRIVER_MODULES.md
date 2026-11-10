# Driver module source and release

`src/driver-app.js` is the composition entry for ten domain modules:
`camera`, `detector`, `calibration`, `metrics`, `alerts`, `storage-history`,
`cloud-sync`, `event-outbox-adapter`, `scoring-core`, and `ui`. The adapter imports the sole shared
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

Browser spoken cues use the shared alerts helper with explicit `en-US` language,
independent of the device's preferred language. Existing English alert, tracking,
camera, detector and rest-stop wording stays unchanged. Translated voice and
safety wording requires fluent human review.

The separately pinned copy source `src/driver-i18n.js` owns 88 ordinary keys in
English, Spanish, French, Portuguese, German, Arabic, Chinese and Japanese. Its
299-key English source also records 211 protected English entries, including the
language notice. `uiText` in the core publishes explicit keys and parameters for
current start, voice, feedback-validation and generated camera-caption states.
It also reads the keyed optional catalog at call time, accepts only nonempty
string results and catches missing, malformed or throwing APIs, keeping its exact
English fallback.
Static selectors bind ordinary headings, controls, accessible names and metric
labels; the external overview source publishes its own current state metadata.
The optional renderer never reverse-matches English phrases, translates device
names, reads user data as copy, or changes input values or numeric formatting.
In particular, PERCLOS digits and `%` remain ASCII because fleet telemetry reads
them back. The report formatter, event selection, thresholds and all voice cues
are unchanged.

The parked eight-language picker keeps its selection in memory if storage is
unavailable. Arabic sets page RTL; ordinary fields carry their chosen language
and protected English text retains `lang="en" dir="ltr"`. Driver-owned markup is
excluded from the legacy language observer, whose other-page behavior remains.
After the base load event, a non-English selection makes the language adapter
clone an inert HTML template
containing the catalog's versioned URL, SHA-256 SRI and anonymous CORS attribute.
English startup does not fetch it. Missing, corrupt or delayed catalog bytes
leave the original English controls usable. Late arrival renders current keys;
a direct English-only replacement invalidates any older ordinary binding. Native
controls carry the language of their associated ordinary names without changing
range direction or raw input values. Numeric overview recovery restores English/LTR
ownership. The observer ignores raw frame metrics, log entries and unrelated
English guidance instead of sweeping static bindings on each camera frame.
Both original chart initialization calls finish before an initially stalled
catalog fetch. The catalog joins only the integrity-verified optional worker path, outside the
default install and critical startup lists. It is never a readiness prerequisite.

Language, overview and guard now have registered copy-mode source as well. They
were registered byte-for-byte before editing and released with the compiled
core and new catalog in one explicit initial-copy transaction. Leading
indentation outside JavaScript strings/template segments was removed from the
legacy language source with parsed-program identity proof, funding the adapter
without raising the 126,000-byte core ceiling or 375,000-byte static-list budget.
`test:driver-startup` includes catalog parity/fallback and chart scheduling
proofs; `tests/driver-i18n.spec.mjs` exercises Spanish/Arabic, late or failed
loading, denied storage, raw telemetry and repeated language changes.

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

`lint:source` checks the eleven JavaScript sources for undefined globals, reassignment and other
ownership mistakes. `typecheck:source` checks detector and alerts with strict
JSDoc/nullability. `test:event-outbox` separately typechecks the shared TypeScript
engine. Other modules remain JavaScript without a full typecheck claim.
`test:driver-build` exercises actual compiler/release invariants and rejected
mutations. Existing behavioral tests continue reading the real active output
selected by `asset-versions.json`; their files and harnesses are unchanged.

Released scoring/calibration phases, EAR smoothing, nod history and alert eligibility
are pure functions in `scoring-core.js`. The UI adapters retain their separate
wall-clock reads, DOM effects and alert delivery. Offline orchestration stays in
`benchmark/scoring-step.mjs`; it is not a compiler input or deployment asset.
See [SCORING_REPLAY.md](SCORING_REPLAY.md) for the independent immutable-release
oracle, versioned trace inputs, timing limits and named counterfactual variants.
