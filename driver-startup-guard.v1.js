
(() => {
  const corePath = '/driver-app.v80.js';
  let state = 'loading';
  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const element = byId(id); if (element) element.textContent = value; };
  // HTML may still be streaming when the deadline expires. Paint once all
  // recovery controls exist, even if a later dependency still blocks parsing.
  const failureNodes = ['startupNotice', 'startupReload', 'driverControls', 'startBtn', 'driveState', 'calibration', 'risk', 'riskDetail', 'status', 'overlay'];
  const observer = new MutationObserver(() => {
    if (state === 'failed' && failureNodes.every(id => byId(id))) { observer.disconnect(); refresh(); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  function refresh() {
    const failed = state === 'failed', ready = state === 'ready';
    const controls = byId('driverControls'), startButton = byId('startBtn');
    if (controls) controls.disabled = !ready;
    if (startButton) { startButton.disabled = !ready; startButton.textContent = ready ? 'START MONITORING' : failed ? 'APP UNAVAILABLE' : 'Loading app…'; }
    const notice = byId('startupNotice');
    if (notice) { notice.hidden = ready; notice.setAttribute('role', failed ? 'alert' : 'status'); notice.setAttribute('aria-live', failed ? 'assertive' : 'polite'); }
    setText('startupTitle', failed ? 'App could not load' : 'Loading app…');
    setText('startupMessage', failed ? 'No monitoring is active. Reload the app when safely parked.' : 'Monitoring controls will be available when the app finishes loading.');
    const reload = byId('startupReload');
    if (reload) { reload.hidden = !failed; reload.onclick = () => location.reload(); }
    setText('driveState', 'NOT MONITORING');
    setText('driveHint', ready ? 'Press Start Monitoring only when safely parked.' : 'Monitoring has not started.');
    setText('calibration', 'NOT STARTED');
    setText('risk', '--'); setText('riskDetail', '--');
    setText('status', ready ? 'OFFLINE' : failed ? 'APP UNAVAILABLE' : 'LOADING');
    const card = byId('stateCard'); if (card) card.className = 'card state-card';
    const status = byId('status'); if (status) status.className = 'status off';
    if (failed) {
      setText('overlayTitle', 'Monitoring unavailable');
      setText('overlayText', 'The app did not finish loading. No camera monitoring is active.');
      setText('overlayHint', 'Reload the app only when safely parked.');
      const overlay = byId('overlay'); if (overlay) overlay.classList.remove('hide');
    }
  }
  function fail() {
    if (state !== 'loading') return;
    state = 'failed'; clearTimeout(deadline);
    if (failureNodes.every(id => byId(id))) observer.disconnect();
    refresh();
  }
  function getNavigationElapsedMs() {
    try {
      if (typeof performance !== 'object' || typeof performance.now !== 'function') return 0;
      const responseStart = performance.getEntriesByType?.('navigation')?.[0]?.responseStart || 0;
      const elapsed = performance.now() - responseStart;
      return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    } catch (_) { return 0; }
  }
  const navigationElapsedMs = getNavigationElapsedMs();
  const deadline = setTimeout(fail, Math.max(0, 8000 - navigationElapsedMs));
  function isCore(value) {
    try { return new URL(value, location.href).pathname === corePath; } catch (_) { return false; }
  }
  window.addEventListener('error', event => {
    if (isCore(event.filename || '') || (event.target?.tagName === 'SCRIPT' && isCore(event.target.src))) fail();
  }, true);
  document.addEventListener('DOMContentLoaded', () => { if (state !== 'ready') refresh(); }, { once: true });
  window.OcculertStartup = Object.freeze({
    isReady: () => state === 'ready',
    refresh: () => { if (state !== 'ready') refresh(); },
    ready: core => {
      if (state !== 'loading') { if (state === 'failed') refresh(); return false; }
      // Timer tasks cannot run while synchronous initialization is busy.
      if (getNavigationElapsedMs() >= 8000) { fail(); return false; }
      if (!core || core.version !== 'v68' || !Object.isFrozen(core) ||
          !['start', 'stop', 'findCameraChoices', 'initModel'].every(key => typeof core[key] === 'function') ||
          typeof byId('startBtn')?.onclick !== 'function') { fail(); return false; }
      state = 'ready'; clearTimeout(deadline); observer.disconnect(); refresh(); return true;
    }
  });
  // Accept a previously completed core too, without starting any monitoring.
  // Expired startup remains terminal even when the guard itself arrives late.
  if (navigationElapsedMs >= 8000) fail();
  else if (window.OcculertDriverCore) window.OcculertStartup.ready(window.OcculertDriverCore);
})();
