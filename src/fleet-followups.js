(function () {
  'use strict';
  var backend = window.OcculertBackend;
  var panel = document.getElementById('fleetFollowups'), list = document.getElementById('followupList');
  var notice = document.getElementById('followupNotice'), refresh = document.getElementById('followupRefresh');
  var rows = [], drafts = new Map(), blocked = new Map(), generation = 0, busy = false, controller = null;
  var context = null, loaded = false, ready = false, pendingSave = null, loadedAt = null;
  var labels = { open: 'Open', in_progress: 'In progress', reviewed: 'Reviewed' };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!backend || !panel || !list || !notice || !refresh) return;
  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  var filters = node('fieldset', undefined, 'followup-filters');
  filters.appendChild(node('legend', 'Filter saved follow-ups'));
  var driverField = node('div', undefined, 'followup-filter-field');
  var driverLabel = node('label', 'Driver name contains'); driverLabel.htmlFor = 'followupDriverFilter';
  var driverSearch = node('input'); driverSearch.type = 'search'; driverSearch.id = 'followupDriverFilter';
  driverSearch.maxLength = 80; driverSearch.autocomplete = 'off'; driverSearch.placeholder = 'Search loaded driver names';
  driverField.append(driverLabel, driverSearch);
  var statusField = node('div', undefined, 'followup-filter-field');
  var statusLabel = node('label', 'Saved status'); statusLabel.htmlFor = 'followupStatusFilter';
  var statusFilter = node('select'); statusFilter.id = 'followupStatusFilter';
  [['all', 'All saved statuses'], ['open', 'Open'], ['in_progress', 'In progress'], ['reviewed', 'Reviewed']].forEach(function (entry) {
    var option = node('option', entry[1]); option.value = entry[0]; statusFilter.appendChild(option);
  });
  statusField.append(statusLabel, statusFilter); filters.append(driverField, statusField);
  var counts = node('p', undefined, 'followup-counts'); counts.setAttribute('role', 'status'); counts.setAttribute('aria-live', 'polite');
  var draftNotice = node('p', undefined, 'followup-draft-notice'); draftNotice.setAttribute('aria-live', 'polite');
  list.before(filters, counts, draftNotice);
  function userId() { return backend.currentUser()?.id || ''; }
  function fail(message, code) { var problem = new Error(message); problem.code = code; return problem; }
  function viewCurrent() {
    if (context && !backend.isAuthContextCurrent(context)) { reset(); return false; }
    return true;
  }
  function setBusy(value) {
    busy = value; refresh.disabled = value; filters.disabled = value;
    list.setAttribute('aria-busy', String(value));
    list.querySelectorAll('select').forEach(function (element) { element.disabled = value || !ready; });
    list.querySelectorAll('button[data-session]').forEach(function (element) {
      element.disabled = value || !ready || !drafts.has(element.dataset.session) || blocked.has(element.dataset.session);
    });
  }
  function recordedTime(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    var time = Date.parse(value); return Number.isFinite(time) ? time : null;
  }
  function completionLabel(session) {
    if (session.ended_at === null || session.ended_at === undefined || session.ended_at === '') return 'No recorded end time';
    var start = recordedTime(session.started_at), end = recordedTime(session.ended_at);
    return start !== null && end !== null && end >= start && end <= Date.now() ? 'Completed session' : 'Invalid recorded dates';
  }
  function alertCountLabel(value) {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object' ||
        (typeof value === 'string' && !value.trim())) return 'Alert count not recorded';
    var count = Number(value); return Number.isSafeInteger(count) && count >= 0 ? count + ' reported alerts' : 'Alert count not recorded';
  }
  function matchingRows() {
    var name = driverSearch.value.trim().toLocaleLowerCase(), status = statusFilter.value;
    return rows.filter(function (session) {
      return (!name || session.driver_name.toLocaleLowerCase().includes(name)) && (status === 'all' || session.followup.status === status);
    });
  }
  function updateCounts() {
    var totals = { open: 0, in_progress: 0, reviewed: 0 };
    rows.forEach(function (session) { totals[session.followup.status] += 1; });
    counts.textContent = matchingRows().length + ' of ' + rows.length + ' latest sessions match (up to 50 loaded). Saved statuses: ' +
      totals.open + ' Open, ' + totals.in_progress + ' In progress, ' + totals.reviewed + ' Reviewed. Open includes sessions without a saved follow-up. Unsaved choices do not change these counts.' +
      (loadedAt ? ' Last loaded ' + new Date(loadedAt).toLocaleString() + '.' : '');
    draftNotice.textContent = drafts.size ? drafts.size + (drafts.size === 1 ? ' unsaved choice' : ' unsaved choices') +
      ' across loaded sessions. Filters may hide a choice. Save each change or explicitly discard it by refreshing.' : 'No unsaved follow-up choices.';
  }
  function render() {
    if (!viewCurrent()) return;
    list.replaceChildren();
    var selected = matchingRows();
    selected.forEach(function (session) {
      var item = node('form', undefined, 'followup-item'), title = node('h3', session.driver_name);
      var start = recordedTime(session.started_at);
      var description = node('p', (start !== null ? new Date(start).toLocaleString() : 'Date unavailable') +
        ' · ' + completionLabel(session) + ' · ' + alertCountLabel(session.alert_count), 'muted');
      var saved = node('p', 'Saved status: ' + labels[session.followup.status] +
        (session.followup.version === 0 ? ' (not yet saved)' : ''), 'followup-saved');
      var pending = node('p', drafts.has(session.id) ? 'Unsaved choice: ' + labels[drafts.get(session.id)] : 'No unsaved change for this session.', 'followup-pending');
      var issue = node('p', blocked.get(session.id) || '', 'followup-issue'); issue.hidden = !blocked.has(session.id);
      var label = node('label', 'Follow-up for ' + session.driver_name), select = node('select', undefined, 'select');
      select.id = 'followup-' + session.id; label.htmlFor = select.id;
      Object.keys(labels).forEach(function (value) { var option = node('option', labels[value]); option.value = value; select.appendChild(option); });
      select.value = drafts.get(session.id) || session.followup.status;
      var button = node('button', 'Save follow-up', 'btn'); button.type = 'submit'; button.dataset.session = session.id;
      select.addEventListener('change', function () {
        if (!viewCurrent()) return;
        if (select.value === session.followup.status) drafts.delete(session.id); else drafts.set(session.id, select.value);
        pending.textContent = drafts.has(session.id) ? 'Unsaved choice: ' + labels[drafts.get(session.id)] : 'No unsaved change for this session.';
        updateCounts(); setBusy(busy);
      });
      var controls = node('div', undefined, 'followup-controls'); controls.append(label, select, button);
      item.append(title, description, saved, pending, issue, controls);
      item.addEventListener('submit', function (event) { event.preventDefault(); void save(session); }); list.appendChild(item);
    });
    if (!selected.length) list.appendChild(node('p', rows.length ? 'No loaded sessions match these saved-status and driver filters.' :
      'No protected follow-up sessions are loaded.', 'muted'));
    updateCounts(); setBusy(busy);
  }
  function reset() {
    generation += 1; controller?.abort(); controller = null;
    rows = []; drafts.clear(); blocked.clear(); context = null; loaded = false; ready = false; pendingSave = null; loadedAt = null;
    driverSearch.value = ''; statusFilter.value = 'all';
    panel.hidden = true; panel.open = false; list.replaceChildren(); notice.textContent = ''; counts.textContent = ''; draftNotice.textContent = '';
    setBusy(false);
  }
  function validSaved(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && typeof value.status === 'string' &&
      Object.hasOwn(labels, value.status) && Number.isSafeInteger(value.version) && value.version >= 0 && value.version <= 2147483647;
  }
  function selectRows(data) {
    if (!data || data.ok !== true || !Array.isArray(data.sessions) || data.sessions.length > 50) throw fail('Follow-up records could not be verified. Refresh to try again.');
    var ids = new Set();
    return data.sessions.map(function (session) {
      if (!session || typeof session.id !== 'string' || !UUID.test(session.id) || ids.has(session.id.toLowerCase()) ||
          typeof session.driver_name !== 'string' || !validSaved(session.followup)) throw fail('Follow-up records could not be verified. Refresh to try again.');
      ids.add(session.id.toLowerCase());
      return { id: session.id, driver_name: session.driver_name.slice(0, 80) || 'Driver', started_at: session.started_at,
        ended_at: session.ended_at, alert_count: session.alert_count,
        followup: { status: session.followup.status, version: session.followup.version, updated_at: session.followup.updated_at } };
    });
  }
  async function request(method, body) {
    var expectedUser = userId(), version = generation;
    if (!viewCurrent() || !expectedUser) throw fail('Sign in as the fleet owner to use follow-ups.', 'auth_session_changed');
    var abort = new AbortController(); controller = abort;
    var timer;
    try {
      return await Promise.race([
        (async function () {
          var auth = await backend.getSession();
          if (abort.signal.aborted || version !== generation) throw fail('The request was cancelled.', 'cancelled');
          var captured = backend.captureAuthContext();
          if (userId() !== expectedUser || auth?.user?.id !== expectedUser || !auth.access_token || !captured.auth ||
              captured.auth.access_token !== auth.access_token || captured.auth.refresh_token !== auth.refresh_token || captured.auth.user?.id !== expectedUser) {
            throw fail('Your account changed. Refresh the fleet dashboard.', 'auth_session_changed');
          }
          backend.requireAuthContext(captured); context = captured;
          var response = await backend.fetchWithDeadline('/api/fleet-followups', {
            method: method, credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.access_token },
            body: body ? JSON.stringify(body) : undefined,
          });
          var data = await response.json();
          if (abort.signal.aborted || version !== generation) throw fail('The request was cancelled.', 'cancelled');
          backend.requireAuthContext(captured);
          if (!response.ok) {
            var problem = fail(response.status === 409 ? 'This saved outcome changed elsewhere. Your choice remains unsaved; refresh before saving it again.' :
              data.error === 'followups_not_enabled' ? 'Saved follow-ups are not enabled yet. The fleet dashboard is still available.' :
              response.status === 401 || response.status === 403 ? 'Sign in as the verified fleet owner to use follow-ups.' :
              'Follow-ups could not be saved or loaded. Refresh to check the saved state before trying again.',
              response.status === 401 || response.status === 403 ? 'auth_session_changed' : 'request_failed');
            problem.conflict = response.status === 409; problem.uncertain = method === 'POST' && response.status >= 500; throw problem;
          }
          return data;
        })(),
        new Promise(function (_, reject) {
          timer = setTimeout(function () {
            var problem = fail('The request timed out. Your choices remain unsaved; refresh to check the saved state before trying again.', 'request_timeout');
            problem.uncertain = method === 'POST'; reject(problem); abort.abort();
          }, 8000);
        }),
      ]);
    } finally { clearTimeout(timer); if (controller === abort) controller = null; }
  }
  async function load(discardConfirmed) {
    if (busy || panel.hidden || !panel.open || document.hidden || !viewCurrent()) return;
    if (drafts.size && !discardConfirmed && !window.confirm('Refreshing will discard ' + drafts.size + ' unsaved follow-up choices. Saved outcomes are kept. Refresh anyway?')) return;
    drafts.clear(); blocked.clear(); ready = false;
    var version = generation; setBusy(true); render(); notice.textContent = 'Loading saved follow-ups…';
    try {
      var selected = selectRows(await request('GET'));
      if (version !== generation || !viewCurrent()) return;
      rows = selected; loaded = true; ready = true; loadedAt = Date.now(); render();
      notice.textContent = 'Latest ' + rows.length + ' sessions loaded (up to 50). Reviewed records a manager marker; it does not verify telemetry or driver safety.';
    } catch (problem) {
      if (version !== generation) return;
      if (problem.code === 'auth_session_changed' || context && !backend.isAuthContextCurrent(context)) { reset(); return; }
      notice.textContent = problem.message + (rows.length ? ' Previously loaded records are shown; saving is disabled until a successful refresh.' : '');
    } finally { if (version === generation) setBusy(false); }
  }
  async function save(session) {
    if (busy || !ready || panel.hidden || !panel.open || document.hidden || !viewCurrent() || !drafts.has(session.id) || blocked.has(session.id)) return;
    var version = generation, choice = drafts.get(session.id); pendingSave = session.id; setBusy(true); notice.textContent = 'Saving this follow-up…';
    try {
      var data = await request('POST', { session_id: session.id, status: choice, expected_version: session.followup.version });
      if (version !== generation || !viewCurrent()) return;
      if (!data || data.ok !== true || !validSaved(data.followup) || data.followup.session_id !== session.id ||
          data.followup.status !== choice || data.followup.version !== session.followup.version + 1) {
        var invalid = fail('The saved result was not confirmed. Your choice remains unsaved; refresh before trying again.'); invalid.uncertain = true; throw invalid;
      }
      session.followup = { status: data.followup.status, version: data.followup.version, updated_at: data.followup.updated_at };
      drafts.delete(session.id); blocked.delete(session.id); render();
      notice.textContent = 'Follow-up saved for ' + session.driver_name + '. Other unsaved choices have been kept.';
    } catch (problem) {
      if (version !== generation) return;
      if (problem.code === 'auth_session_changed' || context && !backend.isAuthContextCurrent(context)) { reset(); return; }
      var uncertain = !problem.conflict && (problem.uncertain || problem.code !== 'request_failed');
      notice.textContent = uncertain ? 'The saved result is unknown. Your local choice is kept. Refresh follow-ups to check the saved state before trying again.' : problem.message;
      if (problem.conflict || uncertain) blocked.set(session.id, notice.textContent + ' Refresh is required before another save.');
      render();
    } finally { if (version === generation) { pendingSave = null; setBusy(false); } }
  }
  function pauseRequest() {
    if (!busy) return;
    generation += 1; controller?.abort(); controller = null;
    if (pendingSave) {
      blocked.set(pendingSave, 'This save was interrupted and its result is unknown. Your choice remains unsaved here. Refresh before saving again.');
      notice.textContent = 'A save was interrupted. Its saved result is unknown; your unsaved choices are kept. Refresh follow-ups to check the saved state before another save.';
    } else notice.textContent = 'Loading was interrupted. Previously loaded records and any unsaved choices are kept. Refresh follow-ups to continue.';
    pendingSave = null; ready = false; setBusy(false);
    if (!panel.hidden && context) render();
  }
  panel.addEventListener('toggle', function () {
    if (panel.open) { if (loaded) render(); else void load(false); }
    else pauseRequest();
  });
  refresh.addEventListener('click', function () { void load(false); });
  driverSearch.addEventListener('input', render); statusFilter.addEventListener('change', render);
  window.addEventListener('storage', function (event) { if (event.key === 'occulert-auth' || event.key === null) reset(); });
  window.addEventListener('focus', viewCurrent);
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseRequest(); else viewCurrent(); });
  window.addEventListener('beforeunload', function (event) {
    if (viewCurrent() && drafts.size) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', reset);
  window.OcculertFollowups = { reset: reset, show: function () { panel.hidden = false; } };
})();
