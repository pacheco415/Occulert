// One Vercel Function serves these explicit API paths to fit the Hobby
// deployment limit. Dispatch from the actual path, never a query parameter.
const handlers = Object.freeze({
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
    if (pathname === '/api/fleet-period-report' && process.env.VERCEL_ENV === 'preview') {
      const urlParams = publicUrl.searchParams;
      const queryKeys = query && typeof query === 'object' ? Object.keys(query) : [];
      response.setHeader('X-Occulert-Preview-Route', [
        'ue=' + urlParams.getAll('endpoint').length,
        'uem=' + Number(urlParams.get('endpoint') === routeName),
        'ud=' + urlParams.getAll('days').length,
        'ud7=' + Number(urlParams.get('days') === '7'),
        'uo=' + [...urlParams.keys()].filter(key => key !== 'endpoint' && key !== 'days').length,
        'qe=' + (Array.isArray(query?.endpoint) ? 'array' : typeof query?.endpoint),
        'qem=' + Number(query?.endpoint === routeName),
        'qd=' + (Array.isArray(query?.days) ? 'array' : typeof query?.days),
        'qd7=' + Number(query?.days === '7'),
        'qo=' + queryKeys.filter(key => key !== 'endpoint' && key !== 'days').length,
      ].join(';'));
    }
    if (query && Object.hasOwn(query, 'endpoint') && query.endpoint !== routeName) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      return response.end(JSON.stringify({ error: 'invalid_query' }));
    }
    // Vercel may add routing metadata to request.query, and its query property
    // can be a getter. Build the forwarded query from the public URL instead.
    // The original URL remains intact for duplicate/unknown-key validation.
    // Preserve the original request stream for Stripe's raw-body signature.
    if (pathname === '/api/billing-webhook') {
      return handlers[pathname](request, response);
    }
    const forwarded = Object.create(request);
    Object.defineProperty(forwarded, 'query', {
      value: Object.fromEntries(publicUrl.searchParams), enumerable: true,
    });
    return handlers[pathname](forwarded, response);
  }
  response.statusCode = 404;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ error: "not_found" }));
};
