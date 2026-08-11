/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: 'watch',
  name: 'OcculertWatch',
  displayName: 'Occulert',
  deploymentTarget: '11.0',
  icon: '../../assets/icon.png',
  colors: {
    $accent: '#2563eb',
  },
  frameworks: ['SwiftUI', 'UserNotifications', 'WatchConnectivity', 'WatchKit'],
});
