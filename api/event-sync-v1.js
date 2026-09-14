// Stable-ID native event sync contract. The native client treats this route as
// unavailable on older deployments and retains its durable queue for retry.
const events = require('./events');
module.exports = function eventSyncV1(request, response) {
  request.occulertSyncVersion = 1;
  return events(request, response);
};
