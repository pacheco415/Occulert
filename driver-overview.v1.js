(function (root) {
  'use strict';
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
  const count = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  function summarize(rows, driverId, now) {
    const owned = rows.filter(row => row.driverId === driverId && !row.experiment && !String(row.detectorVersion || '').includes(':parked:'));
    const dated = owned.filter(row => Number.isFinite(time(row.startedAt)));
    const recent = dated.filter(row => time(row.startedAt) >= now - WEEK && time(row.startedAt) <= now)
      .sort((a, b) => time(b.startedAt) - time(a.startedAt));
    const duration = row => {
      const start = time(row.startedAt), end = time(row.endedAt);
      return Number.isFinite(end) && end >= start && end <= now ? (end - start) / 60000 : null;
    };
    const minutes = recent.map(duration);
    return {
      sessions: recent.length,
      minutes: minutes.every(value => value !== null) ? Math.round(minutes.reduce((sum, value) => sum + value, 0)) : null,
      alerts: recent.every(row => count(row.alerts)) ? recent.reduce((sum, row) => sum + row.alerts, 0) : null,
      missingDates: owned.length - dated.length,
      latest: recent[0] || null,
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = { summarize };
  if (!root.document) return;
  const panel = document.getElementById('driverOverview');
  const parked = document.getElementById('parkedControls');
  if (!panel || !parked) return;
  const put = (id, text) => { document.getElementById(id).textContent = text; };
  function refresh() {
    if (parked.hidden) return;
    try {
      const id = localStorage.getItem('occulert-driver-id');
      if (!id || !root.OcculertLocalHistory) throw Error('History unavailable');
      // Read-only: the overview never migrates, rewrites, or uploads history.
      const summary = summarize(root.OcculertLocalHistory.parse(localStorage.getItem('occulert-session-history')), id, Date.now());
      put('overviewSessions', String(summary.sessions));
      put('overviewMinutes', summary.minutes === null ? 'Unavailable' : String(summary.minutes));
      put('overviewAlerts', summary.alerts === null ? 'Unavailable' : String(summary.alerts));
      put('overviewLastSession', summary.latest ? 'Latest saved session · ' + new Date(summary.latest.startedAt).toLocaleString() : 'No saved sessions in the last 7 days');
      const alerts = summary.latest?.alerts;
      put('overviewNextStep', !summary.latest
        ? 'Before your next session, mount your phone, center your face, and check sound and vibration while parked.'
        : count(alerts) && alerts > 0
          ? 'Your latest session recorded ' + alerts + ' alert' + (alerts === 1 ? '' : 's') + '. Open History while parked to review the saved session before planning your next drive.'
          : count(alerts) && alerts === 0
            ? 'Your latest session recorded zero alerts. This is not a readiness check. Review your session while parked.'
            : 'Your latest session has no recorded alert total. Open History to review what was saved.');
      put('overviewCoverage', summary.missingDates
        ? 'Some saved records have missing dates and are excluded. Totals cover only dated sessions for this browser profile.'
        : summary.minutes === null || summary.alerts === null
          ? 'Some saved sessions have missing totals. Unavailable values are not counted as zero.'
          : 'Last 7 days · up to 50 saved local records · this browser profile only. Parked detection experiments are excluded.');
    } catch (_) {
      for (const id of ['overviewSessions', 'overviewMinutes', 'overviewAlerts']) put(id, 'Unavailable');
      put('overviewLastSession', 'Local history unavailable');
      put('overviewNextStep', 'Your saved history could not be read on this device. You can still complete a parked setup check.');
      put('overviewCoverage', 'Saved records have not been changed. Check browser storage access before reviewing history.');
    }
  }
  document.getElementById('overviewRefresh').addEventListener('click', refresh);
  document.getElementById('overviewAlertCheck').addEventListener('click', () => {
    if (!parked.hidden && !document.body.classList.contains('monitoring-active')) {
      const result = document.getElementById('alertCheckResult');
      const diagnostics = result.closest('details');
      if (diagnostics) diagnostics.open = true;
      document.getElementById('demoBtn').click();
      result.scrollIntoView({ block: 'nearest' });
    }
  });
  new MutationObserver(() => { if (!parked.hidden) refresh(); }).observe(parked, { attributes: true, attributeFilter: ['hidden'] });
  root.addEventListener('storage', event => {
    if (event.key === null || ['occulert-driver-id', 'occulert-session-history'].includes(event.key)) refresh();
  });
  refresh();
})(globalThis);
