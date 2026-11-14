import { strings } from './strings.ts';
/** Informational Apple guides only; no settings, permissions or emergency APIs. */
export const EMERGENCY_READINESS_COPY = {
  title: strings.settings.emergency.copy.title,
  parked: strings.settings.emergency.copy.parked,
  limits: strings.settings.emergency.copy.limits,
  availability: strings.settings.emergency.copy.availability,
  privacy: strings.settings.emergency.copy.privacy,
} as const;

export const EMERGENCY_READINESS_GUIDES = [
  {
    id: 'medical-id',
    title: strings.settings.emergency.guides.medicalId.title,
    detail: strings.settings.emergency.guides.medicalId.detail,
    url: 'https://support.apple.com/en-us/105072',
  },
  {
    id: 'emergency-sos',
    title: strings.settings.emergency.guides.emergencySos.title,
    detail: strings.settings.emergency.guides.emergencySos.detail,
    url: 'https://support.apple.com/guide/iphone/iph3c99374c/ios',
  },
  {
    id: 'crash-detection',
    title: strings.settings.emergency.guides.crashDetection.title,
    detail: strings.settings.emergency.guides.crashDetection.detail,
    url: 'https://support.apple.com/en-us/104959',
  },
  {
    id: 'watch-siren',
    title: strings.settings.emergency.guides.watchSiren.title,
    detail: strings.settings.emergency.guides.watchSiren.detail,
    url: 'https://support.apple.com/guide/watch/apd49c8baf38/watchos',
  },
  {
    id: 'watch-haptics',
    title: strings.settings.emergency.guides.watchHaptics.title,
    detail: strings.settings.emergency.guides.watchHaptics.detail,
    url: 'https://support.apple.com/en-us/108368',
  },
] as const;

export type EmergencyReadinessGuide = typeof EMERGENCY_READINESS_GUIDES[number];
