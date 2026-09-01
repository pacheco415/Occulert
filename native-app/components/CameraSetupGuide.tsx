import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CameraSetupAssessment } from '../lib/cameraSetup';

interface CameraSetupGuideProps {
  active: boolean;
  assessment: CameraSetupAssessment;
  disabled: boolean;
  onTogglePreview: () => void;
}

interface SetupCheckProps {
  complete: boolean;
  label: string;
}

const SetupCheck = memo(function SetupCheck({ complete, label }: SetupCheckProps) {
  return (
    <View style={styles.check}>
      <Ionicons
        name={complete ? 'checkmark-circle' : 'ellipse-outline'}
        size={16}
        color={complete ? '#30d158' : '#7890a2'}
      />
      <Text style={[styles.checkText, complete && styles.checkTextComplete]}>{label}</Text>
    </View>
  );
});

export const CameraSetupGuide = memo(function CameraSetupGuide({
  active,
  assessment,
  disabled,
  onTogglePreview,
}: CameraSetupGuideProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${assessment.title}. ${assessment.detail}`}
      style={[styles.card, assessment.ready && styles.cardReady]}
    >
      <View style={styles.header}>
        <View style={[styles.icon, assessment.ready && styles.iconReady]}>
          <Ionicons
            name={assessment.ready ? 'checkmark' : 'scan-outline'}
            size={19}
            color={assessment.ready ? '#07150d' : '#b9e6ff'}
          />
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>PARKED CAMERA CHECK</Text>
          <Text style={styles.title}>{assessment.title}</Text>
          <Text style={styles.detail}>{assessment.detail}</Text>
        </View>
      </View>

      {active && (
        <View style={styles.checks}>
          <SetupCheck complete={assessment.faceCentered && assessment.faceSized} label="Face framed" />
          <SetupCheck complete={assessment.facingCamera} label="Mount aimed" />
          <SetupCheck complete={assessment.eyesVisible} label="Eyes visible" />
        </View>
      )}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityHint={active
          ? 'Stops the parked camera setup preview'
          : 'Starts a private on-device camera preview for positioning the mounted phone'}
        accessibilityState={{ disabled }}
        activeOpacity={0.8}
        disabled={disabled}
        onPress={onTogglePreview}
        style={[styles.button, disabled && styles.buttonDisabled]}
      >
        <Ionicons name={active ? 'pause' : 'camera-outline'} size={17} color="#dff4ff" />
        <Text style={styles.buttonText}>{active ? 'PAUSE CAMERA CHECK' : 'START CAMERA CHECK'}</Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(8, 20, 31, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(100, 210, 255, 0.28)',
    borderRadius: 16,
    padding: 14,
  },
  cardReady: {
    borderColor: 'rgba(48, 209, 88, 0.55)',
    backgroundColor: 'rgba(7, 30, 19, 0.94)',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(100, 210, 255, 0.14)',
  },
  iconReady: { backgroundColor: '#30d158' },
  copy: { flex: 1 },
  eyebrow: { color: '#64d2ff', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  title: { color: '#f5f7fa', fontSize: 15, fontWeight: '900', marginTop: 3 },
  detail: { color: '#b3bccb', fontSize: 11, lineHeight: 16, marginTop: 3 },
  checks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  checkText: { color: '#7890a2', fontSize: 10, fontWeight: '800' },
  checkTextComplete: { color: '#a7f3c2' },
  button: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(100, 210, 255, 0.35)',
    borderRadius: 12,
    backgroundColor: 'rgba(37, 99, 235, 0.28)',
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#dff4ff', fontSize: 11, fontWeight: '900', letterSpacing: 0.55 },
});
