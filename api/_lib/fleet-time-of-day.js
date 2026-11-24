const { isJsonObject } = require('./validation');
const { validTimestamp } = require('./fleet-history-cursor');

const reportFields = ['version', 'days', 'window_start', 'window_end', 'timezone', 'blocks'];
const blockFields = ['start_hour', 'monitored_minutes', 'drowsy_alerts', 'distracted_alerts',
  'rate_available', 'drowsy_alerts_per_hour'];

function exactFields(value, fields) {
  return isJsonObject(value) && Object.keys(value).length === fields.length &&
    fields.every(key => Object.hasOwn(value, key));
}

function validBlock(block, index) {
  if (!exactFields(block, blockFields) || block.start_hour !== index * 4 ||
      !Number.isFinite(block.monitored_minutes) || block.monitored_minutes < 0 ||
      !Number.isSafeInteger(block.drowsy_alerts) || block.drowsy_alerts < 0 ||
      !Number.isSafeInteger(block.distracted_alerts) || block.distracted_alerts < 0 ||
      block.rate_available !== (block.monitored_minutes >= 120)) return false;
  if (!block.rate_available) return block.drowsy_alerts_per_hour === null;
  // The database rounds rates to four decimal places. Allow half a unit
  // in that last place, plus the floating-point error in the calculation.
  const expected = block.drowsy_alerts * 60 / block.monitored_minutes;
  const tolerance = 0.00005 + Number.EPSILON * Math.max(1, expected) * 2;
  return Number.isFinite(block.drowsy_alerts_per_hour) && block.drowsy_alerts_per_hour >= 0 &&
    Math.abs(block.drowsy_alerts_per_hour - expected) <= tolerance;
}

function validTimeReport(report, days) {
  return exactFields(report, reportFields) && report.version === 1 && report.days === days &&
    report.timezone === 'America/Los_Angeles' && validTimestamp(report.window_start) &&
    validTimestamp(report.window_end) && Date.parse(report.window_start) < Date.parse(report.window_end) &&
    Array.isArray(report.blocks) && report.blocks.length === 6 && report.blocks.every(validBlock);
}

async function fetchTimeOfDayReport(pgFetch, actorId, fleetId, days) {
  const report = await pgFetch('rpc/fleet_time_of_day_report', {
    method: 'POST', body: { p_actor_id: actorId, p_fleet_id: fleetId, p_days: days },
  });
  if (!validTimeReport(report, days)) throw new Error('invalid_report');
  return report;
}

module.exports = { fetchTimeOfDayReport };
