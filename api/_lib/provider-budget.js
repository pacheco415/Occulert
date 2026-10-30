// One monotonic provider budget per request. AsyncLocalStorage isolates concurrent
// requests; nested router/route wrappers keep the original budget. Mutations are
// never retried: a timeout cannot establish whether the provider committed.
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const context = new AsyncLocalStorage();
const REQUEST_PROVIDER_BUDGET_MS = 12000;
function remainingProviderMs(perCallMs) {
  const scope = context.getStore();
  const remaining = scope ? Math.floor(scope.deadline - performance.now()) : perCallMs;
  if (remaining <= 0) {
    const error = new Error('provider_request_budget_exhausted');
    error.status = 504;
    throw error;
  }
  return Math.min(perCallMs, remaining);
}
function withProviderBudget(handler) {
  const wrapped = function(request, response) {
    if (context.getStore()) return handler(request, response);
    const started = performance.now();
    const scope = { deadline: started + REQUEST_PROVIDER_BUDGET_MS, id: randomUUID() };
    return context.run(scope, async () => {
      response.setHeader('X-Occulert-Request-ID', scope.id);
      let unhandled = false;
      try { return await handler(request, response); }
      catch (error) { unhandled = true; throw error; }
      finally {
        const status = Number.isInteger(response.statusCode) ? response.statusCode : null;
        if (unhandled || status >= 500) console.error(JSON.stringify({
          event: 'occulert.api_failure', requestId: scope.id,
          status: status >= 100 && status <= 599 ? status : null,
          elapsedMs: Math.max(0, Math.round(performance.now() - started)),
          unhandled,
        }));
      }
    });
  };
  return Object.assign(wrapped, handler);
}
module.exports = { remainingProviderMs, withProviderBudget };
