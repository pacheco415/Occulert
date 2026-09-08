export const DEFAULT_ALERT_SOUND = 'classic' as const;

export type AlertSound = 'classic' | 'lower' | 'higher';

export interface AlertSoundProfile {
  label: string;
  description: string;
  playbackRate: number;
  shouldCorrectPitch: boolean;
}

/**
 * Sound choices change only the alert tone's pitch profile. The delivery
 * sequence, severity, and centered urgent-alert safeguards remain unchanged.
 */
export const ALERT_SOUND_OPTIONS: readonly [AlertSound, AlertSoundProfile][] = [
  ['classic', {
    label: 'Classic',
    description: 'Current Occulert tone',
    playbackRate: 1,
    shouldCorrectPitch: true,
  }],
  ['lower', {
    label: 'Lower',
    description: 'Deeper alert tone',
    playbackRate: 0.84,
    shouldCorrectPitch: false,
  }],
  ['higher', {
    label: 'Higher',
    description: 'Brighter alert tone',
    playbackRate: 1.18,
    shouldCorrectPitch: false,
  }],
];

const PROFILES: Record<AlertSound, AlertSoundProfile> = {
  classic: ALERT_SOUND_OPTIONS[0][1],
  lower: ALERT_SOUND_OPTIONS[1][1],
  higher: ALERT_SOUND_OPTIONS[2][1],
};

export function parseAlertSound(value: string | null | undefined): AlertSound {
  return value === 'lower' || value === 'higher' ? value : DEFAULT_ALERT_SOUND;
}

export function alertSoundProfile(sound: AlertSound): AlertSoundProfile {
  return PROFILES[sound] ?? PROFILES[DEFAULT_ALERT_SOUND];
}
