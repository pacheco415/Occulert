const base = require('./app.json').expo;
const { BUNDLE_ID, simulatorTraceProfile } = require('./scripts/lib/simulator-trace-profile.cjs');

module.exports = () => {
  if (!simulatorTraceProfile()) return base;
  return {
    ...base,
    name: 'Occulert Simulator Trace',
    scheme: 'occulert-simulator-trace',
    ios: {
      ...base.ios,
      bundleIdentifier: BUNDLE_ID,
      infoPlist: { ...base.ios.infoPlist, OcculertSimulatorTrace: true },
    },
    extra: { ...base.extra, simulatorTrace: true },
    // A layout/scoring simulator does not embed the production Watch target.
    plugins: [...base.plugins.filter(plugin => plugin !== '@bacons/apple-targets'), './plugins/with-simulator-trace'],
  };
};
