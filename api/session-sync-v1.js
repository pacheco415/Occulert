// Stable-ID native session sync contract. Keeping this route versioned makes a
// deployment rollback fail closed instead of sending retries to a legacy API.
const sessions = require('./sessions');
module.exports = function sessionSyncV1(request, response) {
  request.occulertSyncVersion = 1;
  return sessions(request, response);
};
