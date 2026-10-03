// One Vercel Function serves these explicit API paths to fit the Hobby
// deployment limit. Dispatch from the actual path, never a query parameter.
const handlers = Object.freeze({
  "/api/fleet-drivers": require("./_lib/routes/fleet-drivers"),
  "/api/fleet-membership": require("./_lib/routes/fleet-membership"),
  "/api/billing-checkout": require("./_lib/routes/billing-checkout"),
  "/api/billing-portal": require("./_lib/routes/billing-portal"),
  "/api/billing-status": require("./_lib/routes/billing-status"),
  "/api/billing-webhook": require("./_lib/routes/billing-webhook"),
  "/api/fleet-period-report": require("./_lib/routes/fleet-period-report"),
  "/api/fleet-session-history": require("./_lib/routes/fleet-session-history"),
});

module.exports = function handler(request, response) {
  let publicUrl;
  let pathname;
  try {
    publicUrl = new URL(request.url, "https://occulert.invalid");
    pathname = publicUrl.pathname;
  } catch {
    pathname = null;
  }
  if (pathname && Object.hasOwn(handlers, pathname)) {
    const routeName = pathname.slice('/api/'.length);
    const query = request.query;
    if (query && Object.hasOwn(query, 'endpoint') && query.endpoint !== routeName) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      return response.end(JSON.stringify({ error: 'invalid_query' }));
    }
    // Vercel adds one matching [endpoint] parameter to both request.url and
    // request.query. Remove exactly one from the forwarded URL. Extra values
    // that survive Vercel's same-name query normalization, and all other
    // caller parameters and duplicates, remain for strict handlers to reject.
    // Preserve the original request stream for Stripe's raw-body signature.
    if (pathname === '/api/billing-webhook') {
      return handlers[pathname](request, response);
    }
    const urlEntries = [...publicUrl.searchParams.entries()];
    const platformEntry = query?.endpoint === routeName
      ? urlEntries.findIndex(([key, value]) => key === 'endpoint' && value === routeName)
      : -1;
    if (platformEntry !== -1) urlEntries.splice(platformEntry, 1);
    const search = new URLSearchParams(urlEntries).toString();
    const normalizedUrl = pathname + (search ? '?' + search : '');
    const forwarded = Object.create(request);
    Object.defineProperty(forwarded, 'url', { value: normalizedUrl, enumerable: true });
    Object.defineProperty(forwarded, 'query', {
      value: Object.fromEntries(urlEntries), enumerable: true,
    });
    return handlers[pathname](forwarded, response);
  }
  response.statusCode = 404;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ error: "not_found" }));
};
