export interface AccessibilityPreferences {
  reduceMotion: boolean;
  reduceTransparency: boolean;
}

export const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  reduceMotion: false,
  reduceTransparency: false,
};

export function shouldUseGlassEffect(
  apiAvailable: boolean,
  reduceTransparency: boolean,
): boolean {
  return apiAvailable && !reduceTransparency;
}

export function modalAnimationType(reduceMotion: boolean): 'none' | 'fade' {
  return reduceMotion ? 'none' : 'fade';
}
