import { strings, formatString } from '../lib/strings.ts';
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
    <View style={[styles.card, assessment.ready && styles.cardReady]}>
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole="summary"
        accessibilityLabel={formatString(strings.monitor.cameraCheck.assessment, {
          title: assessment.title, detail: assessment.detail,
          checks: active ? ' ' + formatString(strings.monitor.cameraCheck.checkSummary, {
            face: assessment.faceCentered && assessment.faceSized ? strings.monitor.cameraCheck.ready : strings.monitor.cameraCheck.needsAdjustment,
            mount: assessment.facingCamera ? strings.monitor.cameraCheck.ready : strings.monitor.cameraCheck.needsAdjustment,
            eyes: assessment.eyesVisible ? strings.monitor.cameraCheck.ready : strings.monitor.cameraCheck.needsAdjustment,
          }) : '',
        })}
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
            <Text style={styles.eyebrow}>{strings.monitor.cameraCheck.eyebrow}</Text>
            <Text style={styles.title}>{assessment.title}</Text>
            <Text style={styles.detail}>{assessment.detail}</Text>
          </View>
        </View>

        {active && (
          <View style={styles.checks}>
            <SetupCheck complete={assessment.faceCentered && assessment.faceSized} label={strings.monitor.cameraCheck.face} />
            <SetupCheck complete={assessment.facingCamera} label={strings.monitor.cameraCheck.mount} />
            <SetupCheck complete={assessment.eyesVisible} label={strings.monitor.cameraCheck.eyes} />
          </View>
        )}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={active ? strings.monitor.cameraCheck.pauseAccessibilityLabel : strings.monitor.cameraCheck.startAccessibilityLabel}
        accessibilityHint={active
          ? strings.monitor.cameraCheck.pauseHint
          : strings.monitor.cameraCheck.startHint}
        accessibilityState={{ disabled }}
        activeOpacity={0.8}
        disabled={disabled}
        onPress={onTogglePreview}
        style={[styles.button, disabled && styles.buttonDisabled]}
      >
        <Ionicons name={active ? 'pause' : 'camera-outline'} size={17} color="#dff4ff" />
        <Text style={styles.buttonText}>{active ? strings.monitor.cameraCheck.pause : strings.monitor.cameraCheck.start}</Text>
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
  copy: { minWidth: 0, flex: 1 },
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
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#dff4ff', fontSize: 11, fontWeight: '900', letterSpacing: 0.55, textAlign: 'center' },
});
