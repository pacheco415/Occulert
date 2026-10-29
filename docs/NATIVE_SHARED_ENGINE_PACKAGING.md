# Native shared-engine packaging

The native event adapter imports the actual `../../lib/event-outbox.ts` engine.
There is one authored engine, not a native copy. Packaging must retain this
relative layout:

```text
archive/
  native-app/
    lib/nativeEventOutbox.ts
    metro.config.js
    package.json
    package-lock.json
  lib/event-outbox.ts
```

## Metro and archive boundary

`native-app/metro.config.js` extends the installed `expo/metro-config`. It keeps
the native project/server root, hierarchical resolution, node-module paths and
existing resolver exclusions. Only repository `lib` is added to watchFolders.
An additional block-list rule rejects every file in that directory except
`event-outbox.ts`; no repository-wide watch or extra package search path is
added. See [Expo's Metro configuration guidance](https://docs.expo.dev/guides/customizing-metro/).

Root `.easignore` admits only `native-app` and that exact shared file. It retains
every original `.gitignore` exclusion, then also excludes shallow `.git`, all
environment-file variants, npm credentials and local EAS/cache directories.
EAS replaces Git ignore files with this policy. Its file-copy filter tests bare
directory names, so both inclusions and generated-directory exclusions handle
those entries before traversal. An actual empty-archive attempt and a retained
empty `.eas` directory exposed this distinction; regression fixtures cover it.
See [EAS ignore policy](https://docs.expo.dev/build-reference/easignore/) and
[working-tree archive behavior](https://docs.expo.dev/build-reference/project-upload/).

The policy keeps local native module sources, app assets and Watch target
sources. It excludes dependencies, generated iOS/Android projects, generated
Watch assets/plist, signing files, logs, reports and local receipts. Only the
canonical shared engine is admitted from outside the native app.

## Actual archive and iOS export proof

Local validation uses Node `24.19.0`, npm `11.17.0`, installed/locked EAS CLI
`25.3.0`, Expo `58.0.21` and the preview profile. The installed CLI archive branch
only makes the filtered source copy. It does not enter build/submit/version
logic. Expo documents [archive inspection as a command that starts no build](https://docs.expo.dev/eas/cli/#eas-buildinspect).

Use fresh local output directories outside the repository. With paths assigned
to the task-specific variables below, the procedure is:

```sh
cd "$occulertRepo/native-app"
env -u EXPO_PUBLIC_EVENT_OUTBOX CI=1 EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 \
  node "$occulertEas" build:inspect --platform ios --stage archive \
  --profile preview --output "$occulertArchive"

node "$occulertRepo/native-app/scripts/check-native-archive.mjs" \
  "$occulertRepo" "$occulertArchive"

cd "$occulertArchive/native-app"
npm ci --include=dev --offline
env -u EXPO_PUBLIC_EVENT_OUTBOX CI=1 EAS_BUILD_PROFILE=preview \
  EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 \
  node node_modules/expo/bin/cli export -p ios --source-maps --max-workers 2 \
  --output-dir "$occulertExport"

node "$occulertRepo/native-app/scripts/check-native-archive.mjs" \
  "$occulertRepo" "$occulertArchive" "$occulertExport"
```

The first audit checks the pristine archive: allowed layout, regular files,
absence of secret/generated inputs and exact bytes for the canonical engine,
adapter, cloud/monitor callers, package/lock, Metro and EAS configuration. After
install/export, dependencies and generated outputs legitimately exist, so the
second proof checks authored input hashes and export provenance without
mislabeling them as pristine archive contents.

An actual clean install and iOS Hermes export from the inspected archive passed.
The source map resolved the shared engine exactly once, preserving its original
14,099 source characters and canonical SHA-256:

```text
28df17d7ac55cc9e2a618c792d3261f51446306781f5f54243cb05fec22b9930
```

The final frozen-input snapshot contained 159 files: 158 native-app files and
only the shared engine outside that directory. Its exported Hermes bundle was
4,030,652 bytes with SHA-256
`87d5ff5106b7f129e5923a956fd2e009f4e2ea84c9bc868eaac29710f7a590af`.
Post-export checks confirmed all eight authored boundary inputs still matched
the source checkout. The five packaging regressions passed.

`test-native-packaging.mjs` verifies default Metro settings, rejection of other
shared files, real Git-ignore fixtures including bare directory entries, strict
archive layout/hash checks, and export source identity. Runtime tests live in
the app, but the packaging policy test deliberately reads repository-root ignore
files, which the upload whitelist excludes. Run full native verification in the
repository; archive acceptance separately runs the clean install, actual iOS
export and byte/provenance checks above. Public documentation records only
source hashes, layout and local tool/check facts; operational receipts and EAS
inspection/export logs remain local.

This is JavaScript packaging evidence. It starts no native/cloud build,
submission or version operation, sets no outbox flag in an EAS profile, and
does not establish installed-device acceptance.

## Simulator composition

The simulator profile composes its conditional ML Kit resolver with the same
watch-folder/block-list boundary. Preview/production resolution retains ordinary
modules and the existing shared-engine exclusions.

Its local snapshot helper stages the native app as `output/project` and only the
canonical engine at `output/lib/event-outbox.ts`. It checks owned regular UTF-8
input, copies exact bytes and includes that sibling's raw hash among staged
inputs. Metro's `__dirname/../lib` path works in both layouts. The repository and
private work directories are not copied. Existing simulator-build receipts stay
tied to their original native-only source; the changed graph requires a fresh
proof. See [the simulator procedure](../native-app/docs/SIMULATOR_TRACE.md).
