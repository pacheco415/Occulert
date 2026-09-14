const FIELDS = 'id,driver_id,started_at,ended_at,average_fatigue,max_fatigue,safety_score,alert_count,head_nod_count';

function missingSnapshotFunction(error) {
  const code = String(error && error.details && error.details.code || '');
  const message = String(error && error.details && error.details.message || '').toLowerCase();
  return code === 'PGRST202' || code === '42883'
    || (error && error.status === 404 && message.includes('fleet_session_report_v1'));
}

async function readLegacyReport(pgFetch, fleetId, days, from, through) {
  const sessions = await pgFetch('sessions', { params: {
    select: FIELDS,
    fleet_id: 'eq.' + fleetId,
    ended_at: 'not.is.null',
    and: `(started_at.gte.${from},started_at.lte.${through})`,
    order: 'started_at.desc,id.desc',
    limit: '50',
  } });
  // This compatibility path keeps the dashboard usable during a staged
  // deployment, but never claims a paged or fixed-snapshot report is complete.
  return { sessions, days, from, through, complete: false, compatibility: 'legacy_schema' };
}

async function readFleetReport(pgFetch, fleetId, days, now = Date.now()) {
  const from = new Date(now - days * 86400000).toISOString();
  const through = new Date(now).toISOString();
  try {
    const rows = await pgFetch('rpc/fleet_session_report_v1', {
      method: 'POST',
      body: { p_fleet_id: fleetId, p_from: from, p_through: through },
    });
    const report = Array.isArray(rows) ? rows[0] : rows;
    if (!report || !Array.isArray(report.sessions) || typeof report.complete !== 'boolean') {
      throw new Error('invalid_fleet_report');
    }
    return {
      sessions: report.sessions.slice(0, 2000),
      days,
      from,
      through,
      complete: report.complete && report.sessions.length <= 2000,
      compatibility: 'snapshot_v1',
    };
  } catch (error) {
    if (!missingSnapshotFunction(error)) throw error;
    return readLegacyReport(pgFetch, fleetId, days, from, through);
  }
}
module.exports = { readFleetReport };
