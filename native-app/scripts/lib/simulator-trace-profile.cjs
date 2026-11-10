const PROFILE = 'simulator-trace';
const BUNDLE_ID = 'com.occulert.app.simulatortrace';

function simulatorTraceProfile(env = process.env) {
  // EAS CLI evaluates profile env locally before worker-only EAS_BUILD_*
  // variables exist. Explicit profile env must therefore carry these gates.
  const selected = env.OCCULERT_SIMULATOR_PROFILE === PROFILE;
  const requested = env.OCCULERT_SIMULATOR_TRACE === '1';
  if (selected !== requested || requested && (env.OCCULERT_SIMULATOR_PLATFORM !== 'ios'
      || env.EAS_BUILD_PROFILE && env.EAS_BUILD_PROFILE !== PROFILE
      || env.EAS_BUILD_PLATFORM && env.EAS_BUILD_PLATFORM !== 'ios')) {
    throw new Error('Simulator trace requires the simulator-trace profile, iOS platform and explicit build flag together.');
  }
  return selected;
}

module.exports = { PROFILE, BUNDLE_ID, simulatorTraceProfile };
