# Controlled driver startup measurements

`npm run test:browser -- tests/startup-performance.spec.mjs` measures five new browser contexts per browser at 390×844. It records the actual successful driver initialization callback, navigation timings, owned resource timings and byte counts, parser-blocking script dependencies, exact source revision, edited-checkout state, lockfile hash and browser/runtime versions. Every run attaches a JSON receipt to the browser diagnostics artifact.

The explicit software review ceiling is 4,000 ms from navigation start to core initialization, below the app's existing eight-second startup failure deadline. This is a regression budget for this controlled test environment. It is not a phone startup guarantee or a measured production percentile. Median and maximum describe just the five samples; no fleet-wide p95 is inferred.

The loopback origin serves this checkout. Each context starts without HTTP cache or service-worker state; all external requests are blocked. External fonts fall back and the optional remote account SDK is unavailable. The receipt lists these blocked origins. CPU and network are unthrottled. Camera access is prohibited and detector inference is never started. Model startup, authenticated flows, offline caching, physical-device heat/battery and detection accuracy need separate evidence. Existing browser tests continue to cover the optional SDK and offline behavior.

Do not silently raise the ceiling or substitute successful warm loads for cold samples. Review the resource waterfall and source changes before adjusting the budget. A missing initialization callback or permission request fails the test.
