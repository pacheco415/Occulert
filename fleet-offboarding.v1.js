(function () {
  'use strict';
  const backend = window.OcculertBackend;
  if (!backend?.getFleetMembership || !backend.captureAuthContext) return;
  let generation = 0, enabled = false, context = null, membership = null, busy = null;
  const panel = document.getElementById('fleetMembershipPanel');
  const leaveButton = document.getElementById('leaveFleetBtn');
  const status = document.getElementById('fleetMembershipStatus');
  const drivers = document.getElementById('drivers');
  function current() { return !!context && backend.isAuthContextCurrent(context); }
  function clear() {
    enabled = false; membership = null; context = null; busy = null;
    if (leaveButton) leaveButton.disabled = false;
    if (panel) { panel.hidden = true; panel.classList.add('hidden'); }
    if (status) status.textContent = '';
    drivers?.querySelectorAll('[data-remove-fleet-driver]').forEach(button => button.remove());
  }
  function snapshot() { return typeof getProtectedPilotSnapshot === 'function' ? getProtectedPilotSnapshot() : null; }
  function render() {
    if (!enabled || !current()) { clear(); return; }
    if (panel) { const visible = !!membership?.fleet_id; panel.hidden = !visible; panel.classList.toggle('hidden', !visible); }
    const fleet = snapshot();
    if (!drivers || !fleet?.fleetMode || !fleet.fleetId || fleet.userId !== backend.currentUser()?.id) return;
    drivers.querySelectorAll('.driver[data-driver-key]').forEach(row => {
      if (row.querySelector('[data-remove-fleet-driver]')) return;
      const actions = row.querySelector('.driver-actions');
      if (!actions) return;
      let driverId;
      try { driverId = decodeURIComponent(row.dataset.driverKey); } catch { return; }
      if (!fleet.drivers.some(driver => driver.id === driverId)) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn';
      button.textContent = 'Remove from fleet'; button.dataset.removeFleetDriver = driverId;
      button.dataset.offboardingFleet = fleet.fleetId; button.dataset.offboardingOwner = fleet.userId;
      actions.appendChild(button);
    });
  }
  async function refresh(allowRefreshRetry = true) {
    const load = ++generation; clear();
    if (!backend.currentUser()?.id) return;
    const captured = backend.captureAuthContext(), owner = backend.currentUser()?.id;
    try {
      const result = await backend.getFleetMembership();
      if (load !== generation || !result?.ok || result.body?.ok !== true) return;
      if (!backend.isAuthContextCurrent(captured)) {
        if (allowRefreshRetry && owner === backend.currentUser()?.id) void refresh(false);
        return;
      }
      context = captured; enabled = true; membership = result.body.membership; render();
    } catch { /* Disabled or unavailable features expose no destructive controls. */ }
  }
  leaveButton?.addEventListener('click', async () => {
    if (busy || !enabled || !current() || !membership?.fleet_id) return;
    const savedContext = context, fleetId = membership.fleet_id, load = generation;
    if (!window.confirm('Leave your current fleet? Its roster will no longer include you. Past sessions remain in that fleet’s history.')) return;
    if (!current()) return;
    const operation = {}; busy = operation; leaveButton.disabled = true;
    try {
      const result = await backend.leaveFleet(fleetId);
      if (load !== generation || context !== savedContext || !current()) return;
      if (result?.ok && result.body?.ok === true && typeof result.body.left === 'boolean') {
        membership = null; render();
        if (typeof refreshAccountState === 'function') void refreshAccountState();
      } else if (status) status.textContent = result?.body?.error === 'membership_changed' ? 'Your fleet membership changed. Refresh before trying again.' : 'Leaving could not be confirmed. Refresh your membership before trying again.';
    } catch { if (load === generation && current() && status) status.textContent = 'Leaving could not be confirmed. Refresh before trying again.'; }
    finally { if (busy === operation) busy = null; if (load === generation && current()) leaveButton.disabled = false; }
  });
  drivers?.addEventListener('click', async event => {
    const button = event.target.closest('[data-remove-fleet-driver]');
    if (!button || busy || !enabled || !current()) return;
    const fleet = snapshot(), driverId = button.dataset.removeFleetDriver;
    if (!fleet || fleet.fleetId !== button.dataset.offboardingFleet || fleet.userId !== button.dataset.offboardingOwner || fleet.userId !== backend.currentUser()?.id) return;
    const driver = fleet.drivers.find(row => row.id === driverId);
    if (!driver || !window.confirm(`Remove ${String(driver.name || 'this driver').slice(0,80)} from the fleet? Past sessions remain in this fleet’s history.`)) return;
    if (!current()) return;
    const savedContext = context, load = generation, operation = {}; busy = operation; button.disabled = true;
    try {
      const result = await backend.removeFleetDriver(driverId);
      if (load !== generation || context !== savedContext || !current()) return;
      if (result?.ok && result.body?.ok === true && result.body.removed === true && result.body.driver_id === driverId) {
        if (typeof refreshProtectedFleetNow === 'function') await refreshProtectedFleetNow();
      } else if (typeof toast === 'function') toast('Removal could not be confirmed. Refresh the roster before trying again.');
    } catch { if (load === generation && current() && typeof toast === 'function') toast('Removal could not be confirmed. Refresh the roster before trying again.'); }
    finally { if (busy === operation) busy = null; if (load === generation && current() && button.isConnected) button.disabled = false; }
  });
  if (drivers) new MutationObserver(render).observe(drivers, { childList:true, subtree:true });
  window.addEventListener('storage', event => { if (event.key === null || event.key === 'occulert-auth') void refresh(); });
  window.addEventListener('focus', () => { if (!current()) void refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !current()) void refresh(); });
  window.OcculertOffboarding = { refresh };
  void refresh();
})();
