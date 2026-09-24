import React from 'react';
import {
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { colors } from '../constants/theme';
import { useAccessibilityPreferences } from '../hooks/useAccessibilityPreferences';
import { shouldUseGlassEffect } from '../lib/accessibilityPreferencesModel';

interface GlassSurfaceProps extends ViewProps {
  children: React.ReactNode;
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
}

export function GlassSurface({
  children,
  interactive = false,
  style,
  tintColor = 'rgba(34, 42, 56, 0.34)',
  ...viewProps
}: GlassSurfaceProps) {
  const { reduceTransparency } = useAccessibilityPreferences();
  const supportsLiquidGlass = shouldUseGlassEffect(
    Platform.OS === 'ios' && isGlassEffectAPIAvailable(),
    reduceTransparency,
  );

  if (supportsLiquidGlass) {
    return (
      <GlassView
        {...viewProps}
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={tintColor}
        style={style}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View {...viewProps} style={[styles.fallback, style, reduceTransparency && styles.opaqueFallback]}>
      {children}
    </View>
  );
}

export function AmbientBackground() {
  const { reduceTransparency } = useAccessibilityPreferences();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, reduceTransparency && styles.opaqueAmbient]}
      accessibilityElementsHidden
    >
      {!reduceTransparency && <View style={[styles.orb, styles.orbBlue]} />}
      {!reduceTransparency && <View style={[styles.orb, styles.orbCyan]} />}
      {!reduceTransparency && <View style={[styles.orb, styles.orbViolet]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.glassFallback,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  opaqueFallback: {
    backgroundColor: colors.materialStrong,
    borderColor: '#465064',
  },
  opaqueAmbient: {
    backgroundColor: colors.background,
  },
  orb: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    opacity: 0.13,
  },
  orbBlue: {
    backgroundColor: '#3478f6',
    top: -90,
    right: -110,
  },
  orbCyan: {
    backgroundColor: '#32ade6',
    top: 310,
    left: -190,
    opacity: 0.1,
  },
  orbViolet: {
    backgroundColor: '#af52de',
    bottom: -150,
    right: -150,
    opacity: 0.08,
  },
});
