const apple = require('../apple-account');
const { validJsonBody } = require('../validation');
const { json } = require('../responses');

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { error: 'method_not_allowed' });
  }
  if (!apple.configured()) return json(response, 503, { error: 'apple_not_configured' });
  if (!validJsonBody(request, 1024) || typeof request.body.code !== 'string' ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(request.body.code) || typeof request.body.verifier !== 'string' ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(request.body.verifier)) return json(response, 400, { error: 'invalid_callback' });
  try {
    const session = await apple.exchange(request.body.code, request.body.verifier);
    return session ? json(response, 200, session) : json(response, 401, { error: 'apple_sign_in_failed' });
  } catch {
    return json(response, 503, { error: 'apple_unavailable' });
  }
};
