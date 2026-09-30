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
  let pathname;
  try {
    pathname = new URL(request.url, "https://occulert.invalid").pathname;
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
    // Vercel adds the [endpoint] path parameter to request.query. Existing
    // report handlers strictly validate caller queries, so remove that single
    // platform field while retaining the URL and all caller query values.
    // Preserve the original request stream for Stripe's raw-body signature.
    if (pathname === '/api/billing-webhook' || !query || !Object.hasOwn(query, 'endpoint')) {
      return handlers[pathname](request, response);
    }
    const forwarded = Object.create(request);
    forwarded.query = { ...query };
    delete forwarded.query.endpoint;
    return handlers[pathname](forwarded, response);
  }
  response.statusCode = 404;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ error: "not_found" }));
};
