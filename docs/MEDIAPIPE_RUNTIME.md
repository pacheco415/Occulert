# Self-hosted MediaPipe runtime

## Version and provenance

- Upstream: `@mediapipe/face_mesh@0.4.1633559619`, the version already used by the supported monitor.
- Distribution: `https://registry.npmjs.org/@mediapipe/face_mesh/-/face_mesh-0.4.1633559619.tgz`.
- Tarball integrity: `sha512-Vc8cdjxS5+O2gnjWH9KncYpUCVXT0h714KlWAsyqJvJbIgUJBqpppbIx8yWcAzBDxm/5cYSuBI5p5ySIPxzcEg==`.
- Package license: Apache-2.0. The vendored directory retains upstream JavaScript notices, includes Apache LICENSE text from the MediaPipe `v0.8.8` source distribution, and identifies our modifications in `NOTICE.txt`. The Emscripten runtime license text is retained in `EMSCRIPTEN-LICENSE`; its reference tag is not a claim about the package's compiler version.
- Immutable destination: `vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/`.
- `scripts/mediapipe/upstream.json` pins each upstream runtime file. `runtime-manifest.json` in the vendor directory pins each deployed file after patching.

## Files

The complete nine-file distribution contains the top-level loader, model graph, packed model data and its loader, both scalar and SIMD JavaScript/WebAssembly variants, and the upstream empty SIMD data file. Model, graph, data and WebAssembly bytes are unchanged. The top-level `face_mesh.js` is unchanged and retains its existing SHA-384 script integrity pin.

Only `face_mesh_solution_wasm_bin.js` and `face_mesh_solution_simd_wasm_bin.js` are patched. Their three generated-code helpers are replaced by the readable files in `scripts/mediapipe/`:

- `createNamedFunction`: a strict wrapper with a defined function name.
- `craftInvokerFunction`: ordinary argument conversion and native invocation, preserving argument-count checks, function length/name, receiver handling, cleanup order and return conversion.
- `__emval_get_method_caller`: ordinary packed-argument decoding and method invocation, preserving receiver, pointer offsets, object deletion and return conversion.

`upstream-helpers.json` stores the original pinned helpers. Tests compare original and patched behavior, including errors and cleanup, and execute the replacements with string code generation disabled. This is a small compatibility patch, not a rebuild or upgrade of MediaPipe.

## Reproduce

Use a scratch directory outside cloud-backed storage. Download the exact tarball above, verify its SHA-512 against the recorded integrity, then extract it. Do not install or execute package lifecycle scripts.

From the repository root:

```sh
node scripts/vendor-mediapipe.mjs /path/to/extracted/package
npm run audit:site
npm run test:mediapipe
npm run test:browser -- tests/detector-runtime.spec.mjs tests/mediapipe-offline.spec.mjs
```

The vendoring script checks every input hash and requires exactly one occurrence of each original helper in each variant. It refuses a changed upstream runtime. It copies only the nine runtime files, patches the two JavaScript variants, and regenerates the deployed hash manifest. LICENSE, EMSCRIPTEN-LICENSE and NOTICE are retained separately in the checked-in directory.

For an update, choose a **new immutable directory/patch revision**; never overwrite deployed bytes. Review upstream changes and licensing, update the pinned helper snippets if needed, regenerate all hashes, update the driver URL/SRI, service-worker URLs/integrities, Vercel rules and tests, and advance the service-worker cache version. Keep previously published driver URLs available to clients holding older documents. Do not merely refresh hashes to make a failed audit pass.

## Cache behavior and cost

Cache v49 probes SIMD with the pinned runtime’s 29-byte WebAssembly feature probe and verifies only the matching runtime assets using Fetch integrity during installation. Missing files, bad hashes, download errors or storage failures reject installation and delete only the incomplete new cache. The prior cache remains active. Activation removes old caches only after the new critical bundle is complete.

The first homepage installation caches approximately **10.06 MiB (SIMD)** or **9.99 MiB (scalar)** of uncompressed detector assets, instead of both builds (~16 MiB). Neither the unused JavaScript wrapper nor its WASM file is requested. The upstream empty SIMD data file remains pinned and is included only for the SIMD path; its empty digest is intentional. Published runtime bytes and hashes are unchanged.

Both variants remain available on the server. If a later browser update changes SIMD support, the missing variant can be fetched online with integrity verification; it is not guaranteed to be available offline until downloaded. An unavailable variant fails visibly rather than reporting a ready detector. Subsequent requests use immutable URLs and the verified cache.

Directly opening the monitor without first completing a homepage service-worker install does not establish offline readiness. Storage eviction, private browsing and browser restrictions can still remove or prevent offline storage. GPS map links and cloud sync require a connection. Offline capability is not an accuracy or safety certification.

## CSP boundaries

JavaScript `'unsafe-eval'` is removed from all website CSP headers. The monitor also removes the jsDelivr host from its script and connection allowances. `'wasm-unsafe-eval'` remains necessary for WebAssembly compilation. Inline event handlers still require `'unsafe-inline'`; Google Fonts keeps its current allowances. Other pages retain jsDelivr for the existing Supabase SDK fallback, independent of the detector.

## Validation

- Real inference callback under the served policy in Chromium and WebKit, with automatic SIMD selection and a forced scalar fallback, while the CDN is unavailable.
- A normally loaded script proves JavaScript function construction is blocked. DevTools evaluation is not used as evidence of CSP enforcement.
- Missing-asset fresh installation and corrupt-asset upgrade tests, followed by successful retry and real inference with the origin connection cut off in both engines.
- An upgrade fixture preserves the actual v47 worker/document; the published `driver-app.v47.js` remains byte-identical.
- Existing camera selection, tracking-loss, startup failure, consent, and monitoring lifecycle tests remain required.

A blank-frame inference callback exercises the real runtime/model pipeline; it does not measure face-detection accuracy. Physical Safari/iPhone checks and the authorized dataset benchmark remain separate evidence.
