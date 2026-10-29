// Observations only: never fetch, read cached bodies, repair caches, or relax
// startup assertions. The bounded pre-offline snapshot adds observation latency;
// it is not a timing-neutral experiment or a fix for the intermittent failure.
export async function readOfflineCacheSnapshot() {
  const limit = 200;
  const pathOnly = value => {
    try { const url = new URL(value, location.href); return url.origin === location.origin ? url.pathname.slice(0, 300) : '[external]'; }
    catch { return '[invalid]'; }
  };
  const workerInfo = worker => worker ? { path: pathOnly(worker.scriptURL), state: worker.state } : null;
  const registration = await navigator.serviceWorker?.getRegistration();
  const resourceUrls = [...new Set([location.href, ...Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'),
    element => element.src || element.href)])];
  const names = await caches.keys();
  const inventories = [];
  for (const name of names.slice(0, 8)) {
    // CacheStorage.match with cacheName does not create a cache if it was
    // removed after keys(); opening it here could change the observed state.
    const matches = await Promise.all(resourceUrls.slice(0, limit).map(async url => ({
      path: pathOnly(url), cached: Boolean(await caches.match(url, { cacheName: name })),
    })));
    inventories.push({ name: name.slice(0, 120), checkedResources: matches.length,
      matchedPaths: matches.filter(item => item.cached).map(item => item.path) });
  }
  const resources = await Promise.all(resourceUrls.slice(0, limit).map(async url => {
    const response = await caches.match(url);
    return { path: pathOnly(url), cached: Boolean(response), status: response?.status ?? null,
      type: response?.type ?? null };
  }));
  return { path: location.pathname, readyState: document.readyState,
    controller: workerInfo(navigator.serviceWorker?.controller), active: workerInfo(registration?.active),
    waiting: workerInfo(registration?.waiting), installing: workerInfo(registration?.installing),
    controllerIsActive: Boolean(registration?.active && navigator.serviceWorker?.controller === registration.active),
    resources, resourcesTruncated: resourceUrls.length > limit,
    // Network-only optional assets may legitimately be missing. This is
    // evidence, not a readiness assertion or a reason to warm/repair caches.
    missingPaths: resources.filter(resource => !resource.cached).map(resource => resource.path),
    caches: inventories, cachesTruncated: names.length > 8 };
}

export async function recordOfflineCacheSnapshot(page, diagnostics, phase, timeoutMs = 1500) {
  let timer;
  try {
    // Timeout bounds the caller, not the read-only browser evaluation itself.
    const snapshot = await Promise.race([
      page.evaluate(readOfflineCacheSnapshot),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('snapshot-timeout')), timeoutMs); }),
    ]);
    diagnostics.record('offline-cache-snapshot', { phase, snapshot });
  } catch {
    // A closed/unresponsive renderer must not hide the original test failure.
    diagnostics.record('offline-cache-snapshot-unavailable', { phase });
  } finally { clearTimeout(timer); }
}
