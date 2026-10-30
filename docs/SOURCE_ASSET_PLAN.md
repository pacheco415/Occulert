# Editable asset source pilot

The first migration registers only the active driver as `src/driver-app.js`,
using the `copy` mode in `source-assets.json`. Its initial bytes equal
`driver-app.v81.js`; the pilot creates no new immutable asset or cache version
and changes no monitoring behavior. Every retained immutable URL stays intact.

Use `asset:release` to release source edits. It validates all retained integrity
entries against their files and the committed baseline, checks that known
`origin/main` is an ancestor, and compares every registered source with its
active output. When sources match, both ordinary and dry runs leave the checkout
unchanged. The command does not fetch remote refs; fetch current main and relevant
prepared branches before using it.

For changed sources, the existing full-history, merge-aware release planner
chooses unused asset and cache names. It copies active immutable importers and
updates page/runtime URLs, manifests, ordered headers, service-worker lists and
guard/helper integrity pins. A batch advances the cache once. Generated owned
dependency URLs are synchronized into the corresponding registered source, so
the source audit still compares exact bytes. All candidates are staged before
replacing checkout paths; replacement failure restores original files.

The separate source audit covers every registered entry, requires the driver
pilot to remain registered, and enforces deployment/offline exclusions. It does
not claim source coverage of the remaining logical assets. Continue releasing
those through `asset:bump`; when a dependency bump copies the registered driver,
the tool also synchronizes its source. Source edits must be released first to
prevent an importer bump from discarding pending work. An existing unpublished
release must be completed or discarded before another source release.

Before migrating another logical asset:

1. Start from current main and register a byte-exact copy in a separate PR.
2. Prove its active output, retained pins, page references and behavioral tests
   remain unchanged for the initial copy.
3. Add meaningful release coverage for its importer, cache and integrity needs.
4. Keep source and build configuration outside public deployment/offline lists.
5. Run clean full verification and affected browser checks on actual released
   output before publication. Keep superseded assets for the release retention
   window; rollback uses another fresh immutable URL.

The subsequent driver module migration is separate. It must compile its actual
source graph, preserve initialization/effect order and existing behavioral
test/harness contracts, and replace lifecycle reassignment with explicit hooks.
The pilot neither installs a compiler nor changes runtime source structure.

## Current bundled driver

The completed pilot is now followed by the separate module migration in
[DRIVER_MODULES.md](DRIVER_MODULES.md). The driver registration uses `bundle`;
its entry is a composition file, so its bytes do not equal the published bundle.
The source audit recompiles the actual tracked graph and requires exact output
bytes and integrity. The `copy` mode and its byte-equality checks remain available
for other assets. Bundle importer synchronization updates owned module resource
references, compiles a staged graph and proves output equality before writes.
