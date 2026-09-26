const browserLogPrefix = '[occulert-page-load] ';

function pathOnly(value) {
  try { const url = new URL(value); return url.origin + url.pathname; }
  catch { return String(value || '').split(/[?#]/, 1)[0]; }
}

// Keep observations outside page.evaluate so a blocked navigation or closed
// page cannot block failure reporting. Do not record headers, bodies or tokens.
export async function observePageLoads(page) {
  const events = [], removals = new Set(), started = Date.now();
  const requests = new WeakMap(), sockets = new WeakMap();
  let requestId = 0, socketId = 0, dropped = 0, droppedListeners = 0, stopped = false;
  function record(type, detail = {}) {
    if (stopped) return;
    if (events.length >= 1200) { dropped += 1; return; }
    events.push({ elapsedMs: Date.now() - started, type, ...detail });
  }
  function listen(target, name, handler, once = false) {
    if (stopped || removals.size >= 2400) { droppedListeners += 1; return () => {}; }
    const remove = () => { target.off(name, observed); removals.delete(remove); };
    const observed = (...args) => {
      if (once) remove();
      if (!stopped) handler(...args);
    };
    target.on(name, observed);
    removals.add(remove);
    return remove;
  }
  function requestInfo(request) {
    if (!requests.has(request)) requests.set(request, ++requestId);
    let worker = null;
    try { worker = request.serviceWorker?.(); } catch {}
    return { id: requests.get(request), url: pathOnly(request.url()), resource: request.resourceType(),
      navigation: request.isNavigationRequest(), worker: worker ? pathOnly(worker.url()) : null };
  }
  const context = page.context();
  listen(context, 'request', request => record('request', requestInfo(request)));
  listen(context, 'response', response => record('response', { ...requestInfo(response.request()),
    status: response.status(), fromServiceWorker: response.fromServiceWorker() }));
  listen(context, 'requestfinished', request => record('request-finished', requestInfo(request)));
  listen(context, 'requestfailed', request => record('request-failed', { ...requestInfo(request),
    error: request.failure()?.errorText || 'Unknown request failure' }));
  listen(context, 'serviceworker', worker => {
    record('worker-created', { url: pathOnly(worker.url()) });
    listen(worker, 'close', () => record('worker-closed', { url: pathOnly(worker.url()) }), true);
  });
  listen(page, 'console', message => {
    if (message.text().startsWith(browserLogPrefix)) {
      try { record('browser', JSON.parse(message.text().slice(browserLogPrefix.length))); } catch {}
    } else if (message.type() === 'error') record('console-error', { text: message.text().slice(0, 500).replace(/https?:\/\/[^\s]+/g, pathOnly) });
  });
  listen(page, 'pageerror', error => record('page-error', { message: error.message.slice(0, 500).replace(/https?:\/\/[^\s]+/g, pathOnly) }));
  listen(page, 'crash', () => record('page-crashed'), true);
  listen(page, 'close', () => record('page-closed'), true);
  listen(page, 'domcontentloaded', () => record('domcontentloaded', { url: pathOnly(page.url()) }));
  listen(page, 'load', () => record('load', { url: pathOnly(page.url()) }));
  await page.addInitScript(prefix => {
    const seen = new WeakSet();
    const workerInfo = worker => worker ? { script: new URL(worker.scriptURL).pathname, state: worker.state } : null;
    const record = (event, detail = {}) => {
      console.debug(prefix + JSON.stringify({ event, path: location.pathname, readyState: document.readyState,
        initModelType: typeof window.initModel, controller: workerInfo(navigator.serviceWorker?.controller), ...detail }));
    };
    window.__occulertPageLoadRecord = record;
    const observe = worker => {
      if (!worker || seen.has(worker)) return;
      seen.add(worker);
      worker.addEventListener('statechange', () => record('controller-state', { worker: workerInfo(worker) }));
    };
    if (navigator.serviceWorker) {
      observe(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        observe(navigator.serviceWorker.controller); record('controller-change');
      });
    }
    document.addEventListener('DOMContentLoaded', () => record('document-ready'));
    window.addEventListener('load', () => record('window-load'));
    window.addEventListener('pageshow', event => record('page-show', { persisted: event.persisted }));
    window.addEventListener('error', event => {
      const source = event.target?.src || event.target?.href;
      if (source) record('resource-error', { resource: new URL(source, location.href).pathname });
    }, true);
    record('document-start');
  }, browserLogPrefix);

  function observeServer(server, state = () => ({})) {
    listen(server, 'connection', socket => {
      const id = ++socketId; sockets.set(socket, id);
      record('server-connection', { id });
      listen(socket, 'close', hadError => record('server-socket-close', { id, hadError,
        bytesRead: socket.bytesRead, bytesWritten: socket.bytesWritten }), true);
    });
    listen(server, 'request', (request, response) => {
      const detail = { socket: sockets.get(request.socket), path: pathOnly(request.url), ...state() };
      record('server-request', { ...detail, alreadyDestroyed: response.destroyed });
      const removeFinish = listen(response, 'finish', () => record('server-response-finished', { ...detail, status: response.statusCode }), true);
      listen(response, 'close', () => {
        removeFinish();
        record('server-response-closed', { ...detail, status: response.statusCode,
          finished: response.writableFinished, destroyed: response.destroyed });
      }, true);
    });
    listen(server, 'close', () => record('server-closed'), true);
  }
  async function attach(testInfo, name = 'page-load-diagnostics') {
    // Attachment errors must not replace the original test failure.
    try { await testInfo.attach(name, { body: JSON.stringify({ events, dropped, droppedListeners }, null, 2), contentType: 'application/json' }); }
    catch (error) { console.error('Page-load diagnostics could not be attached:', error.message); }
  }
  return { record, observeServer, attach, stop: () => {
    stopped = true;
    for (const remove of removals) remove();
  } };
}
