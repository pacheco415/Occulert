// Return only the reviewed aggregate contract; never forward provider fields.
function pacificMonth(timestamp) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date(timestamp));
  return parts.find(part => part.type === 'year').value + '-' +
    parts.find(part => part.type === 'month').value;
}
function monthlyActivity(value) {
  if (!value || value.version !== 1 || value.definition !== 'completed_session_v1' ||
      value.timezone !== 'America/Los_Angeles' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month) ||
      typeof value.as_of !== 'string' || !Number.isFinite(Date.parse(value.as_of)) ||
      pacificMonth(value.as_of) !== value.month ||
      !Number.isSafeInteger(value.active_drivers) || value.active_drivers < 0) return null;
  return { version: 1, definition: value.definition, timezone: 'America/Los_Angeles',
    month: value.month, as_of: value.as_of, active_drivers: value.active_drivers };
}
module.exports = { monthlyActivity };
