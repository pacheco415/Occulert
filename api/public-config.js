// GET /api/public-config -> browser-safe runtime configuration.
// The Supabase URL and publishable/anon key are intentionally public values.
// Never add the service-role key or any other server secret here.

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function validSupabaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname.endsWith(".supabase.co")
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

module.exports = function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  const url = validSupabaseUrl(process.env.SUPABASE_URL);
  const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
  const configured = Boolean(url && anonKey);

  return json(response, 200, {
    ok: true,
    supabase: configured ? { configured: true, url, anonKey } : { configured: false },
  });
};
