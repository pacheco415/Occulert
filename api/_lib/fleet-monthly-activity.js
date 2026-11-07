// Return only the reviewed aggregate contract; never forward provider fields.
function monthlyActivity(value) {
  if (!value || value.version !== 1 || value.definition !== 'completed_session_v1' ||
      value.timezone !== 'UTC' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month) ||
      typeof value.as_of !== 'string' || !Number.isFinite(Date.parse(value.as_of)) ||
      new Date(value.as_of).toISOString().slice(0, 7) !== value.month ||
      !Number.isSafeInteger(value.active_drivers) || value.active_drivers < 0) return null;
  return { version: 1, definition: value.definition, timezone: 'UTC',
    month: value.month, as_of: value.as_of, active_drivers: value.active_drivers };
}
module.exports = { monthlyActivity };
