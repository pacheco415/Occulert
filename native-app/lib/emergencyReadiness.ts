/** Informational Apple guides only; no settings, permissions or emergency APIs. */
export const EMERGENCY_READINESS_COPY = {
  title: 'Emergency readiness',
  parked: 'Review these Apple guides only while safely parked.',
  limits: 'Occulert does not check or change these Apple settings, activate Emergency SOS, Crash Detection or Siren, contact emergency services, or guarantee help.',
  availability: 'Apple feature support varies by device, software, region and connectivity.',
  privacy: 'Show When Locked makes your Medical ID viewable without a passcode. Emergency-call sharing is a separate, optional feature where available. Review both choices in Apple Health.',
} as const;

export const EMERGENCY_READINESS_GUIDES = [
  {
    id: 'medical-id',
    title: 'Medical ID and emergency contacts',
    detail: 'Review your Medical ID, emergency contacts and sharing choices in Apple Health.',
    url: 'https://support.apple.com/en-us/105072',
  },
  {
    id: 'emergency-sos',
    title: 'Emergency SOS on iPhone',
    detail: 'Review Apple’s setup guidance and connection requirements for your iPhone and region.',
    url: 'https://support.apple.com/guide/iphone/iph3c99374c/ios',
  },
  {
    id: 'crash-detection',
    title: 'Crash Detection on supported devices',
    detail: 'Review supported models and software requirements. Crash Detection cannot detect every crash.',
    url: 'https://support.apple.com/en-us/104959',
  },
  {
    id: 'watch-siren',
    title: 'Siren on Apple Watch Ultra',
    detail: 'Ultra models only: a manually started sound to attract nearby attention. Siren does not contact emergency services.',
    url: 'https://support.apple.com/guide/watch/apd49c8baf38/watchos',
  },
  {
    id: 'watch-haptics',
    title: 'Apple Watch haptic settings',
    detail: 'Review Apple’s haptic settings and fit guidance. A setting does not guarantee that you will feel an alert.',
    url: 'https://support.apple.com/en-us/108368',
  },
] as const;

export type EmergencyReadinessGuide = typeof EMERGENCY_READINESS_GUIDES[number];
