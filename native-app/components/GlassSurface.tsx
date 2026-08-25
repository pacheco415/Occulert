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
  const supportsLiquidGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

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
    <View {...viewProps} style={[styles.fallback, style]}>
      {children}
    </View>
  );
}

export function AmbientBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
      <View style={[styles.orb, styles.orbBlue]} />
      <View style={[styles.orb, styles.orbCyan]} />
      <View style={[styles.orb, styles.orbViolet]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.glassFallback,
    borderWidth: 1,
    borderColor: colors.glassBorder,
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
