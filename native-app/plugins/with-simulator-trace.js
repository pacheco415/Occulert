const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const { BUNDLE_ID, simulatorTraceProfile } = require('../scripts/lib/simulator-trace-profile.cjs');

module.exports = function withSimulatorTrace(config) {
  if (!simulatorTraceProfile() || config.ios?.bundleIdentifier !== BUNDLE_ID) {
    throw new Error('Simulator trace plugin cannot modify a production app.');
  }
  config = withDangerousMod(config, ['android', async () => {
    throw new Error('The scripted detector variant is iOS Simulator only.');
  }]);
  return withXcodeProject(config, project => {
    let constrained = 0;
    for (const entry of Object.values(project.modResults.pbxXCBuildConfigurationSection())) {
      if (!entry || typeof entry !== 'object' || !entry.buildSettings) continue;
      const identifier = String(entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER || '').replaceAll('"', '');
      if (identifier !== BUNDLE_ID) continue;
      // This target cannot be compiled or archived against the iPhone SDK,
      // even if someone invokes Xcode outside the simulator EAS profile.
      entry.buildSettings.SDKROOT = 'iphonesimulator';
      entry.buildSettings.SUPPORTED_PLATFORMS = 'iphonesimulator';
      entry.buildSettings.SUPPORTS_MACCATALYST = 'NO';
      entry.buildSettings.SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = 'NO';
      constrained++;
    }
    if (constrained < 2) throw new Error('Simulator-only phone target configurations were not found.');
    return project;
  });
};
