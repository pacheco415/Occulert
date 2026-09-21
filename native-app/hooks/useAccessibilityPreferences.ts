import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  DEFAULT_ACCESSIBILITY_PREFERENCES,
  type AccessibilityPreferences,
} from '../lib/accessibilityPreferencesModel';

export function useAccessibilityPreferences(): AccessibilityPreferences {
  const [preferences, setPreferences] = useState(DEFAULT_ACCESSIBILITY_PREFERENCES);

  useEffect(() => {
    let active = true;
    let motionRevision = 0;
    let transparencyRevision = 0;
    const motionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      reduceMotion => {
        motionRevision += 1;
        if (active) setPreferences(current => ({ ...current, reduceMotion }));
      },
    );
    const transparencySubscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      reduceTransparency => {
        transparencyRevision += 1;
        if (active) setPreferences(current => ({ ...current, reduceTransparency }));
      },
    );

    const initialMotionRevision = motionRevision;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(reduceMotion => {
        if (active && motionRevision === initialMotionRevision) {
          setPreferences(current => ({ ...current, reduceMotion }));
        }
      })
      .catch(() => {});
    const initialTransparencyRevision = transparencyRevision;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then(reduceTransparency => {
        if (active && transparencyRevision === initialTransparencyRevision) {
          setPreferences(current => ({ ...current, reduceTransparency }));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      motionSubscription.remove();
      transparencySubscription.remove();
    };
  }, []);

  return preferences;
}
