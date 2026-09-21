(function () {
  'use strict';
  var panel = document.getElementById('fleetFollowups');
  var list = document.getElementById('followupList');
  var notice = document.getElementById('followupNotice');
  var refresh = document.getElementById('followupRefresh');
  var rows = [], generation = 0, busy = false, controller = null;
  var labels = { open: 'Open', in_progress: 'In progress', reviewed: 'Reviewed' };
  if (!panel || !list || !notice || !refresh) return;
  function userId() { return window.OcculertBackend?.currentUser()?.id || ''; }
  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function setBusy(value) {
    busy = value;
    refresh.disabled = value;
    list.querySelectorAll('select,button').forEach(function (element) { element.disabled = value; });
    list.setAttribute('aria-busy', String(value));
  }
  function render() {
    list.replaceChildren();
    rows.forEach(function (session) {
      var item = node('form', undefined, 'followup-item');
      var title = node('h3', session.driver_name);
      var date = new Date(session.started_at);
      var description = node('p', (Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Date unavailable') +
        ' · ' + (session.ended_at ? 'Completed session' : 'Session in progress') +
        ' · ' + Math.max(0, Number(session.alert_count) || 0) + ' reported alerts', 'muted');
      var current = labels[session.followup.status] || 'Open';
      var saved = node('p', 'Saved status: ' + current + (session.followup.version === 0 ? ' (not yet saved)' : ''), 'followup-saved');
      var label = node('label', 'Follow-up for ' + session.driver_name);
      var select = node('select', undefined, 'select');
      select.id = 'followup-' + session.id;
      label.htmlFor = select.id;
      Object.keys(labels).forEach(function (value) {
        var option = node('option', labels[value]); option.value = value; select.appendChild(option);
      });
      select.value = session.followup.status;
      var button = node('button', 'Save follow-up', 'btn'); button.type = 'submit';
      var controls = node('div', undefined, 'followup-controls'); controls.append(label, select, button);
      item.append(title, description, saved, controls);
      item.addEventListener('submit', function (event) { event.preventDefault(); void save(session, select.value); });
      list.appendChild(item);
    });
    setBusy(busy);
  }
  function reset() {
    generation += 1;
    if (controller) controller.abort();
    controller = null;
    rows = [];
    panel.hidden = true;
    panel.open = false;
    list.replaceChildren();
    notice.textContent = '';
    setBusy(false);
  }
  async function request(method, body) {
    var expectedUser = userId(), version = generation;
    if (!expectedUser) throw new Error('Sign in as a fleet owner to use follow-ups.');
    var abort = new AbortController(); controller = abort;
    var timer;
    try {
      return await Promise.race([
        (async function () {
          var auth = await window.OcculertBackend.getSession();
          if (version !== generation || userId() !== expectedUser || auth?.user?.id !== expectedUser || !auth.access_token) {
            throw new Error('Your account changed. Refresh the fleet dashboard.');
          }
          var response = await fetch('/api/fleet-followups', {
            method: method, credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.access_token },
            body: body ? JSON.stringify(body) : undefined,
          });
          var data = await response.json();
          if (version !== generation || userId() !== expectedUser) throw new Error('Your account changed. Refresh the fleet dashboard.');
          if (!response.ok) {
            var error = new Error(response.status === 409 ? 'This follow-up changed elsewhere. Refresh before saving again.' :
              data.error === 'followups_not_enabled' ? 'Saved follow-ups are not enabled yet. Your fleet dashboard is still available.' :
              response.status === 401 || response.status === 403 ? 'Sign in as the verified fleet owner to use follow-ups.' :
              'Follow-ups could not be saved or loaded. Check your connection and refresh.');
            error.conflict = response.status === 409; throw error;
          }
          return data;
        })(),
        new Promise(function (_, reject) {
          timer = setTimeout(function () { abort.abort(); reject(new Error('The request timed out. Refresh to check the saved status before trying again.')); }, 8000);
        }),
      ]);
    } finally { clearTimeout(timer); if (controller === abort) controller = null; }
  }
  async function load() {
    if (busy || panel.hidden || !panel.open || document.hidden) return;
    var version = generation;
    setBusy(true); rows = []; render(); notice.textContent = 'Loading saved follow-ups…';
    try {
      var data = await request('GET');
      if (version !== generation) return;
      rows = Array.isArray(data.sessions) ? data.sessions : [];
      render(); notice.textContent = rows.length ? 'Latest ' + rows.length + (rows.length === 1 ? ' session' : ' sessions') + ' shown (up to 50). Reviewed means a manager recorded a review, not that a driver is safe to drive.' : 'No protected sessions yet.';
    } catch (error) { if (version === generation) notice.textContent = error.message; }
    finally { if (version === generation) setBusy(false); }
  }
  async function save(session, status) {
    if (busy || panel.hidden || !panel.open || document.hidden) return;
    var version = generation;
    setBusy(true); notice.textContent = 'Saving follow-up…';
    try {
      var data = await request('POST', { session_id: session.id, status: status, expected_version: session.followup.version });
      if (version !== generation) return;
      session.followup = data.followup; render(); notice.textContent = 'Follow-up saved.';
    } catch (error) {
      if (version !== generation) return;
      notice.textContent = error.message;
      if (error.conflict) { rows = []; render(); }
    } finally { if (version === generation) setBusy(false); }
  }
  panel.addEventListener('toggle', function () {
    if (panel.open) void load();
    else { generation += 1; controller?.abort(); rows = []; list.replaceChildren(); setBusy(false); }
  });
  refresh.addEventListener('click', function () { void load(); });
  window.addEventListener('storage', function (event) { if (event.key === 'occulert-auth' || event.key === null) reset(); });
  window.OcculertFollowups = {
    reset: reset,
    show: function () { panel.hidden = false; },
  };
})();
