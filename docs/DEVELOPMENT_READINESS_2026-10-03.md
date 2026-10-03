# Development readiness — October 3, 2026

Development resumed from main `2afd06977a18a7414883e84adafdb64014b708bb`
on branch `development-readiness-2026-10-03`, using Node 24.19.0.

## Completed change

Updated the native lockfile's brace-expansion 2.1.4 to 2.1.7 and 5.0.9
to 5.0.12, preserving each consumer's major version and all other locked
packages. These patches address the published recursion and rewrite-loop
denial-of-service advisories:

- [Nested brace recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7)
- [Rewrite-loop CPU exhaustion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)
- [Comma parser recursion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)

Dependency regression tests resolve the actual Apple-target and Expo fingerprint
consumer chains. They check normal glob expansion and hostile nested/rewrite
patterns in workers with a three-second deadline. These checks run in the
existing native verification command and CI jobs.

## Local validation

- Root `npm run verify`: passed on the starting main source.
- Browser suite: 300 passed across Chromium and WebKit on the starting source.
- Watch notification Swift harness: passed on the starting source.
- Native clean `npm ci --include=dev`: passed with the updated lockfile.
- Native `npm run verify`: passed after the update, including Expo dependency
  compatibility, TypeScript, and all five dependency regression tests.
- Native npm audit: brace-expansion finding removed; affected-package entries
  decreased from 23 to 22 high-severity entries. This is not a count of distinct
  vulnerabilities or proof of application exploitability.

The root/browser/Watch checks preceded the native-only lockfile and dependency
test changes. Physical-device acceptance and a native binary build were not run.

## Remaining work

The read-only Supabase migration-history connection failed. Applied migration
state remains unknown; no database changes were made. Do not infer that schema
prerequisites are present from local tests.

The remaining native dependency findings include
[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and
[node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv), which list no
patched version as checked on October 3. npm's suggested major downgrades do
not establish compatibility with the current Expo/React Native toolchain.
Keep these findings open for upstream fixes and a separate compatibility review.

This receipt records local development evidence. It does not establish a
deployment, hosted CI result, native distribution, accuracy, or device acceptance.
