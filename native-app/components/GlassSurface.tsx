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
  tintColor = 'rgba(25, 48, 76, 0.34)',
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
    opacity: 0.2,
  },
  orbBlue: {
    backgroundColor: '#246bfe',
    top: -90,
    right: -110,
  },
  orbCyan: {
    backgroundColor: '#00c4e8',
    top: 310,
    left: -190,
    opacity: 0.15,
  },
  orbViolet: {
    backgroundColor: '#7048e8',
    bottom: -150,
    right: -150,
    opacity: 0.13,
  },
});
