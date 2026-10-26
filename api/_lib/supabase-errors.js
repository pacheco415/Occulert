// Keep provider outages separate from invalid responses and route-level errors.
// Only the Supabase transport marks upstream errors; arbitrary application
// exceptions must not be mistaken for an outage.
function supabaseErrorStatus(error) {
  if (error?.status === 504) return 504;
  if (error?.provider === 'supabase' && Number.isInteger(error.status) && error.status >= 500 && error.status <= 599) return 503;
  return 502;
}

module.exports = { supabaseErrorStatus };
