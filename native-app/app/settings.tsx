import { strings, formatString } from '../lib/strings.ts';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Switch, TouchableOpacity, Alert, Linking, AppState, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAlertAudioPlayer } from '../hooks/useAlertAudioPlayer';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { SensitivitySlider, loadSavedSensitivity } from '../components/SensitivitySlider';
import { EYE_BASELINE_EXPERIMENT } from '../lib/eyeBaselineModel';
import { clearDeviceEyeBaseline } from '../lib/eyeBaselineStorage';
import type { SensitivityLevel } from '../constants/thresholds';
import { openFeedbackWithFallback } from '../lib/feedback';
import { getWatchStatus, sendAlertToWatch, type WatchStatus } from '../lib/watchBridge';
import {
  getWatchAlertsEnabled,
  setWatchAlertsEnabled,
  WATCH_ALERTS_PREFERENCE_KEY,
} from '../lib/watchPreferences';
import { CloudSyncCard } from '../components/CloudSyncCard';
import { EmergencyReadinessCard } from '../components/EmergencyReadinessCard';
import { AmbientBackground } from '../components/GlassSurface';
import { colors, radii } from '../constants/theme';
import { currentAppBuildInfo, formatAppBuildLabel } from '../lib/appBuildInfo';
import { createSettingPersister } from '../lib/settingPersistence';
import { createSingleFlightActionRunner } from '../lib/singleFlightAction';
import { configureAlertAudioMode } from '../lib/audioSession';
import {
  getHeadphoneMotionStatus,
  type HeadphoneMotionStatus,
} from '../lib/headphoneMotion';
import {
  parseInEarAlertPattern,
  type InEarAlertPattern,
} from '../lib/inEarAlerts';
import {
  AUDIO_ALERT_PREFERENCE_KEY,
  ALERT_SOUND_PREFERENCE_KEY,
  HAPTIC_ALERT_PREFERENCE_KEY,
  IN_EAR_ALERT_PREFERENCE_KEY,
  alertPreferenceStorage,
  loadAlertPreferences,
} from '../lib/alertPreferences';
import {
  ALERT_SOUND_OPTIONS,
  alertSoundProfile,
  configureAlertSound,
  parseAlertSound,
  type AlertSound,
} from '../lib/alertSound';
import { alertDeliveryPlan } from '../lib/alertDelivery';
import { waitForCancellableDelay } from '../lib/cancellableDelay';
import { clearSessionHistory, loadSessionHistory } from '../lib/sessionHistory';
import {
  clearActiveSessionCheckpoint,
  discardUnreadableActiveSessionCheckpoint,
  loadActiveSessionCheckpoint,
} from '../lib/sessionRecovery';
import { ActiveSessionCheckpointUnreadableError } from '../lib/sessionRecoveryModel';

const EMPTY_WATCH_STATUS: WatchStatus = {
  moduleAvailable: false,
  paired: false,
  appInstalled: false,
  reachable: false,
};

const EMPTY_HEADPHONE_MOTION_STATUS: HeadphoneMotionStatus = {
  state: 'not-built',
  authorization: 'unavailable',
  isAvailable: false,
  isActive: false,
};

const ALERT_SOUND = require('../assets/alert.wav');
const ALERT_SOUND_DURATION_MS = 800;

const storedSettingPersister = createSettingPersister(alertPreferenceStorage);
const watchSettingPersister = createSettingPersister({
  async getItem() {
    return String(await getWatchAlertsEnabled(true));
  },
  async setItem(_key, value) {
    await setWatchAlertsEnabled(value === 'true');
  },
});

const showSettingSaveError = () => {
  Alert.alert(
    strings.settings.saveError.title,
    strings.settings.saveError.detail,
  );
};

const describeHeadphoneMotion = (status: HeadphoneMotionStatus): string => {
  switch (status.state) {
    case 'active':
      return strings.settings.headphoneMotion.description.active;
    case 'starting':
      return strings.settings.headphoneMotion.description.starting;
    case 'stopped':
      return status.authorization === 'notDetermined'
        ? strings.settings.headphoneMotion.description.permissionPending
        : strings.settings.headphoneMotion.description.available;
    case 'denied':
      return strings.settings.headphoneMotion.description.denied;
    case 'unavailable':
      return strings.settings.headphoneMotion.description.notConnected;
    case 'error':
      return strings.settings.headphoneMotion.description.error;
    default:
      return strings.settings.headphoneMotion.description.unavailable;
  }
};

const labelHeadphoneMotion = (status: HeadphoneMotionStatus): string => {
  switch (status.state) {
    case 'active': return strings.settings.headphoneMotion.status.active;
    case 'starting': return strings.settings.headphoneMotion.status.starting;
    case 'stopped': return strings.settings.headphoneMotion.status.ready;
    case 'denied': return strings.settings.headphoneMotion.status.denied;
    case 'unavailable': return strings.settings.headphoneMotion.status.notConnected;
    case 'error': return strings.settings.headphoneMotion.status.check;
    default: return strings.settings.headphoneMotion.status.unavailable;
  }
};

export default function SettingsScreen() {
  const router = useRouter();
  const [baselineResetBusy, setBaselineResetBusy] = useState(false);
  const baselineResetBusyRef = useRef(false);
  const [sens, setSens] = useState<SensitivityLevel>('medium');
  const [haptic, setHaptic] = useState(true);
  const [audio, setAudio] = useState(true);
  const [alertSound, setAlertSound] = useState<AlertSound>('classic');
  const [inEarPattern, setInEarPattern] = useState<InEarAlertPattern>('balanced');
  const [watch, setWatch] = useState(false);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>(EMPTY_WATCH_STATUS);
  const [headphoneMotionStatus, setHeadphoneMotionStatus] = useState<HeadphoneMotionStatus>(
    EMPTY_HEADPHONE_MOTION_STATUS,
  );
  const [audioTestBusy, setAudioTestBusy] = useState(false);
  const [watchTestBusy, setWatchTestBusy] = useState(false);
  const [deviceRefreshBusy, setDeviceRefreshBusy] = useState(false);
  const [localSessionCount, setLocalSessionCount] = useState<number | null>(null);
  const [recoveryDataPresent, setRecoveryDataPresent] = useState<boolean | null>(null);
  const [recoverySessionId, setRecoverySessionId] = useState<string | null>(null);
  const [recoveryDataUnreadable, setRecoveryDataUnreadable] = useState(false);
  const [localDataStatusBusy, setLocalDataStatusBusy] = useState(true);
  const [localDataBusy, setLocalDataBusy] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  // This parked-only test must release the shared iOS audio session when the
  // tone ends so music and navigation audio can return to their normal level.
  const { player: audioTestPlayer } = useAlertAudioPlayer(ALERT_SOUND);
  const audioTestRunnerRef = useRef(createSingleFlightActionRunner());
  const watchTestRunnerRef = useRef(createSingleFlightActionRunner());
  const deviceRefreshRunnerRef = useRef(createSingleFlightActionRunner());
  const localDataStatusRunnerRef = useRef(createSingleFlightActionRunner());
  const feedbackRunnerRef = useRef(createSingleFlightActionRunner());
  const settingsMountedRef = useRef(true);
  const settingsFocusedRef = useRef(false);
  const settingsViewRevisionRef = useRef(0);
  const audioTestAbortRef = useRef<AbortController | null>(null);
  const watchAvailable = watchStatus.paired && watchStatus.appInstalled;
  const appBuildLabel = formatAppBuildLabel(currentAppBuildInfo());

  useEffect(() => {
    settingsMountedRef.current = true;
    return () => {
      settingsMountedRef.current = false;
      audioTestAbortRef.current?.abort();
      audioTestAbortRef.current = null;
      try { audioTestPlayer.pause(); } catch {}
    };
  }, [audioTestPlayer]);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadSavedSensitivity(),
      loadAlertPreferences(true),
    ]).then(([savedSensitivity, savedAlerts]) => {
      if (!active) return;
      setSens(savedSensitivity);
      setHaptic(savedAlerts.hapticEnabled);
      setAudio(savedAlerts.audioEnabled);
      setAlertSound(savedAlerts.alertSound);
      setInEarPattern(savedAlerts.inEarPattern);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const refreshLocalDataStatus = useCallback(() => {
    void localDataStatusRunnerRef.current.run({
      action: async () => {
        const [historyResult, checkpointResult] = await Promise.allSettled([
          loadSessionHistory(),
          loadActiveSessionCheckpoint(),
        ]);
        if (!settingsMountedRef.current) return;
        setLocalSessionCount(historyResult.status === 'fulfilled' ? historyResult.value.length : null);
        setRecoveryDataPresent(checkpointResult.status === 'fulfilled' ? Boolean(checkpointResult.value) : null);
        setRecoverySessionId(checkpointResult.status === 'fulfilled' ? checkpointResult.value?.sessionId ?? null : null);
        setRecoveryDataUnreadable(checkpointResult.status === 'rejected'
          && checkpointResult.reason instanceof ActiveSessionCheckpointUnreadableError);
      },
      onBusyChange: busy => {
        if (settingsMountedRef.current) setLocalDataStatusBusy(busy);
      },
      onError: () => {
        if (!settingsMountedRef.current) return;
        setLocalSessionCount(null);
        setRecoveryDataPresent(null);
        setRecoverySessionId(null);
        setRecoveryDataUnreadable(false);
      },
    });
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    settingsFocusedRef.current = true;
    Promise.all([
      getWatchStatus(),
      getWatchAlertsEnabled(true),
      getHeadphoneMotionStatus(),
    ]).then(([status, saved, motionStatus]) => {
      if (!active) return;
      setWatchStatus(status);
      setWatch(saved);
      setHeadphoneMotionStatus(motionStatus);
    }).catch(() => {});
    refreshLocalDataStatus();
    return () => {
      active = false;
      settingsFocusedRef.current = false;
      settingsViewRevisionRef.current += 1;
    };
  }, [refreshLocalDataStatus]));

  const sendFeedback = () => {
    const revision = settingsViewRevisionRef.current;
    const isActive = () => settingsMountedRef.current
      && settingsFocusedRef.current
      && revision === settingsViewRevisionRef.current
      && AppState.currentState === 'active';
    if (!isActive()) return;
    void feedbackRunnerRef.current.run({
      action: () => openFeedbackWithFallback(undefined, isActive),
      onBusyChange: busy => {
        if (settingsMountedRef.current) setFeedbackBusy(busy);
      },
      onError: () => {
        if (isActive()) Alert.alert(strings.settings.feedback.unavailableTitle, strings.settings.feedback.unavailableDetail);
      },
    });
  };

  const saveBooleanSetting = (
    key: string,
    nextValue: boolean,
    previousValue: boolean,
    apply: (value: boolean) => void,
  ) => {
    void storedSettingPersister.save({
      key,
      nextValue,
      previousValue,
      serialize: String,
      parse: value => value === 'true',
      apply,
      onError: showSettingSaveError,
    });
  };

  const chooseInEarPattern = (pattern: InEarAlertPattern) => {
    void storedSettingPersister.save({
      key: IN_EAR_ALERT_PREFERENCE_KEY,
      nextValue: pattern,
      previousValue: inEarPattern,
      serialize: String,
      parse: parseInEarAlertPattern,
      apply: setInEarPattern,
      onError: showSettingSaveError,
    });
  };

  const chooseAlertSound = (sound: AlertSound) => {
    void storedSettingPersister.save({
      key: ALERT_SOUND_PREFERENCE_KEY,
      nextValue: sound,
      previousValue: alertSound,
      serialize: String,
      parse: parseAlertSound,
      apply: setAlertSound,
      onError: showSettingSaveError,
    });
  };

  const changeWatchAlerts = (enabled: boolean) => {
    void watchSettingPersister.save({
      key: WATCH_ALERTS_PREFERENCE_KEY,
      nextValue: enabled,
      previousValue: watch,
      serialize: String,
      parse: value => value === 'true',
      apply: setWatch,
      onError: showSettingSaveError,
    });
  };

  const watchDescription = !watchStatus.moduleAvailable
    ? strings.settings.watch.description.unavailable
    : !watchStatus.paired
      ? strings.settings.watch.description.openCompanion
      : !watchStatus.appInstalled
        ? strings.settings.watch.description.confirmInstallation
        : watchStatus.reachable
          ? strings.settings.watch.description.enableBackground
          : strings.settings.watch.description.finishSetup;

  const headphoneMotionDescription = describeHeadphoneMotion(headphoneMotionStatus);
  const headphoneMotionLabel = labelHeadphoneMotion(headphoneMotionStatus);
  const deviceReadinessSummary = watchAvailable
    ? watch
      ? strings.settings.connections.summary.watchEnabled
      : strings.settings.connections.summary.watchDisabled
    : strings.settings.connections.summary.openWatch;

  const refreshConnectedDevices = () => {
    void deviceRefreshRunnerRef.current.run({
      action: async () => {
        const [status, saved, motionStatus] = await Promise.all([
          getWatchStatus(),
          getWatchAlertsEnabled(true),
          getHeadphoneMotionStatus(),
        ]);
        if (!settingsMountedRef.current) return;
        setWatchStatus(status);
        setWatch(saved);
        setHeadphoneMotionStatus(motionStatus);
      },
      onBusyChange: busy => {
        if (settingsMountedRef.current) setDeviceRefreshBusy(busy);
      },
      onError: () => {
        if (!settingsMountedRef.current) return;
        Alert.alert(strings.settings.connections.refreshErrorTitle, strings.settings.connections.refreshErrorDetail);
      },
    });
  };

  const testAudioOutput = () => {
    void audioTestRunnerRef.current.run({
      action: async () => {
        const controller = new AbortController();
        audioTestAbortRef.current?.abort();
        audioTestAbortRef.current = controller;
        try {
          await configureAlertAudioMode();
          if (controller.signal.aborted) return;
          let previousOffset = 0;
          for (const offset of alertDeliveryPlan('critical').audioOffsetsMs) {
            if (
              offset > previousOffset
              && !await waitForCancellableDelay(offset - previousOffset, controller.signal)
            ) return;
            if (controller.signal.aborted) return;
            audioTestPlayer.pause();
            await audioTestPlayer.seekTo(0);
            if (controller.signal.aborted) return;
            configureAlertSound(audioTestPlayer, alertSound);
            audioTestPlayer.volume = 0.85;
            audioTestPlayer.play();
            previousOffset = offset;
          }
          await waitForCancellableDelay(ALERT_SOUND_DURATION_MS / alertSoundProfile(alertSound).playbackRate, controller.signal);
        } finally {
          if (audioTestAbortRef.current === controller) audioTestAbortRef.current = null;
        }
      },
      onBusyChange: busy => {
        if (settingsMountedRef.current) setAudioTestBusy(busy);
      },
      onError: () => {
        if (!settingsMountedRef.current) return;
        Alert.alert(
          strings.settings.audioTest.unavailableTitle,
          strings.settings.audioTest.unavailableDetail,
        );
      },
    });
  };

  const testHapticOutput = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      .then(() => {
        if (settingsMountedRef.current) Alert.alert(
          strings.settings.hapticTest.sentTitle,
          strings.settings.hapticTest.sentDetail,
        );
      })
      .catch(() => {
        if (settingsMountedRef.current) Alert.alert(
          strings.settings.hapticTest.unavailableTitle,
          strings.settings.hapticTest.unavailableDetail,
        );
      });
  };

  const testWatchAlert = () => {
    void watchTestRunnerRef.current.run({
      action: async () => {
        const result = await sendAlertToWatch({ level: 'critical', perclos: 0, at: Date.now() });
        const status = await getWatchStatus();
        if (!settingsMountedRef.current) return;
        setWatchStatus(status);
        if (!result.accepted) {
          Alert.alert(strings.settings.watch.test.unavailableTitle, strings.settings.watch.test.openCompanion);
        } else if (result.acknowledged) {
          const timing = result.roundTripMs === null ? '' : formatString(strings.settings.watch.test.roundTrip, { milliseconds: String(result.roundTripMs) });
          Alert.alert(
            strings.settings.watch.test.receivedTitle,
            formatString(strings.settings.watch.test.receivedDetail, { timing }),
          );
        } else if (result.reachable) {
          Alert.alert(
            strings.settings.watch.test.sentTitle,
            strings.settings.watch.test.sentDetail,
          );
        } else {
          Alert.alert(
            strings.settings.watch.test.backupTitle,
            strings.settings.watch.test.backupDetail,
          );
        }
      },
      onBusyChange: busy => {
        if (settingsMountedRef.current) setWatchTestBusy(busy);
      },
      onError: () => {
        if (!settingsMountedRef.current) return;
        Alert.alert(strings.settings.watch.test.errorTitle, strings.settings.watch.test.errorDetail);
      },
    });
  };

  const deleteAllLocalSessions = async () => {
    if (localDataBusy || localDataStatusBusy || localSessionCount === null || localSessionCount === 0) return;
    setLocalDataBusy(true);
    try {
      await clearSessionHistory();
      if (settingsMountedRef.current) setLocalSessionCount(0);
      Alert.alert(
        strings.settings.localData.delete.successTitle,
        strings.settings.localData.delete.successDetail,
      );
    } catch {
      Alert.alert(strings.settings.localData.delete.errorTitle, strings.settings.localData.delete.errorDetail);
    } finally {
      if (settingsMountedRef.current) setLocalDataBusy(false);
    }
  };

  const confirmDeleteAllLocalSessions = () => {
    Alert.alert(
      strings.settings.localData.delete.confirmTitle,
      strings.settings.localData.delete.confirmDetail,
      [
        { text: strings.settings.common.cancel, style: 'cancel' },
        { text: strings.settings.localData.delete.reviewFirst, onPress: () => router.push('/history') },
        { text: strings.settings.localData.delete.deleteAll, style: 'destructive', onPress: () => { void deleteAllLocalSessions(); } },
      ],
    );
  };

  const clearRecoveryData = async () => {
    if (localDataBusy || localDataStatusBusy || (recoverySessionId === null && !recoveryDataUnreadable)) return;
    setLocalDataBusy(true);
    try {
      if (recoveryDataUnreadable) {
        await discardUnreadableActiveSessionCheckpoint();
      } else if (recoverySessionId) {
        await clearActiveSessionCheckpoint(recoverySessionId);
        if (await loadActiveSessionCheckpoint()) {
          throw new Error('The recovery checkpoint changed before it could be cleared.');
        }
      }
      if (settingsMountedRef.current) setRecoveryDataPresent(false);
      if (settingsMountedRef.current) setRecoverySessionId(null);
      if (settingsMountedRef.current) setRecoveryDataUnreadable(false);
      Alert.alert(strings.settings.localData.recovery.successTitle, strings.settings.localData.recovery.successDetail);
    } catch {
      Alert.alert(strings.settings.localData.recovery.errorTitle, strings.settings.localData.recovery.errorDetail);
      refreshLocalDataStatus();
    } finally {
      if (settingsMountedRef.current) setLocalDataBusy(false);
    }
  };

  const confirmClearRecoveryData = () => {
    Alert.alert(
      recoveryDataUnreadable ? strings.settings.localData.recovery.discardTitle : strings.settings.localData.recovery.clearTitle,
      recoveryDataUnreadable
        ? strings.settings.localData.recovery.discardDetail
        : strings.settings.localData.recovery.clearDetail,
      [
        { text: strings.settings.common.cancel, style: 'cancel' },
        { text: strings.settings.localData.recovery.clearAction, style: 'destructive', onPress: () => { void clearRecoveryData(); } },
      ],
    );
  };

  const openSupportPage = async () => {
    const url = 'https://www.occulert.com/support.html';
    try {
      if (await Linking.canOpenURL(url)) {
        if (!settingsMountedRef.current) return;
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Offer the same manual recovery if the browser cannot open the link.
    }
    if (settingsMountedRef.current) {
      Alert.alert(strings.settings.support.unavailableTitle, strings.settings.support.unavailableDetail);
    }
  };

  const localHistoryDeleteDisabled = localDataBusy
    || localDataStatusBusy
    || localSessionCount === null
    || localSessionCount === 0;
  const recoveryDeleteDisabled = localDataBusy
    || localDataStatusBusy
    || (recoverySessionId === null && !recoveryDataUnreadable);

  return (
    <SafeAreaView style={s.bg}>
      <AmbientBackground />
      <KeyboardAvoidingView style={s.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={s.eyebrow}>{strings.settings.screen.brand}</Text>
        <Text style={s.title}>{strings.settings.screen.title}</Text>
        <View style={s.priorityCard}>
          <View style={s.priorityIcon}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.cyan} />
          </View>
          <View style={s.priorityCopy}>
            <Text style={s.priorityTitle}>{strings.settings.screen.priorityTitle}</Text>
            <Text style={s.priorityText}>{strings.settings.screen.priorityDetail}</Text>
          </View>
        </View>
        {Platform.OS === 'ios' && <EmergencyReadinessCard />}
        <SensitivitySlider value={sens} onChange={setSens} />
        {EYE_BASELINE_EXPERIMENT && <View style={s.card}>
          <Text style={s.cardTitle}>{strings.settings.baseline.title}</Text>
          <Text style={s.sub}>{strings.settings.baseline.detail}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={strings.settings.baseline.resetAccessibility} disabled={baselineResetBusy} onPress={() => {
            if(baselineResetBusyRef.current)return;
            baselineResetBusyRef.current=true;setBaselineResetBusy(true);
            const revision=settingsViewRevisionRef.current;
            void clearDeviceEyeBaseline().then(()=>{
              if(settingsMountedRef.current&&settingsFocusedRef.current&&revision===settingsViewRevisionRef.current)router.push('/monitor');
            }).catch(()=>{if(settingsMountedRef.current&&revision===settingsViewRevisionRef.current)Alert.alert(strings.settings.baseline.errorTitle,strings.settings.baseline.errorDetail);}).finally(()=>{
              baselineResetBusyRef.current=false;if(settingsMountedRef.current)setBaselineResetBusy(false);
            });
          }}><Text style={s.label}>{baselineResetBusy?strings.settings.baseline.resetting:strings.settings.baseline.resetAction}</Text></TouchableOpacity>
        </View>}
        <View style={s.card}>
          <Text style={s.cardTitle}>{strings.settings.alerts.title}</Text>
          <View style={s.row}>
            <View style={s.rowL}><Ionicons name="phone-portrait-outline" size={18} color="#60a5fa" /><View style={s.rowCopy}><Text style={s.label}>{strings.settings.alerts.hapticLabel}</Text><Text style={s.sub}>{strings.settings.alerts.hapticDetail}</Text></View></View>
            <Switch accessibilityLabel={strings.settings.alerts.hapticAccessibility} accessibilityHint={strings.settings.alerts.hapticHint} value={haptic} onValueChange={v=>saveBooleanSetting(HAPTIC_ALERT_PREFERENCE_KEY,v,haptic,setHaptic)} trackColor={{true:'#2563eb',false:'#1a3a4a'}} thumbColor="#fff" />
          </View>
          <View style={s.div}/>
          <View style={s.row}>
            <View style={s.rowL}><Ionicons name="volume-high-outline" size={18} color="#60a5fa" /><View style={s.rowCopy}><Text style={s.label}>{strings.settings.alerts.audioLabel}</Text><Text style={s.sub}>{strings.settings.alerts.audioDetail}</Text></View></View>
            <Switch accessibilityLabel={strings.settings.alerts.audioAccessibility} accessibilityHint={strings.settings.alerts.audioHint} value={audio} onValueChange={v=>saveBooleanSetting(AUDIO_ALERT_PREFERENCE_KEY,v,audio,setAudio)} trackColor={{true:'#2563eb',false:'#1a3a4a'}} thumbColor="#fff" />
          </View>
          <View style={s.div}/>
          <View style={s.soundBlock}>
            <View style={s.rowL}>
              <Ionicons name="musical-notes-outline" size={18} color="#60a5fa" />
              <View style={s.rowCopy}>
                <Text style={s.label}>{strings.settings.alerts.soundTitle}</Text>
                <Text style={s.sub}>{strings.settings.alerts.soundDetail}</Text>
              </View>
            </View>
            <View style={s.soundOptions}>
              {ALERT_SOUND_OPTIONS.map(([value, profile]) => {
                const selected = alertSound === value;
                return (
                  <TouchableOpacity
                    key={value}
                    accessibilityLabel={formatString(strings.settings.alerts.soundAccessibility, { sound: profile.label })}
                    accessibilityHint={profile.description}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[s.soundOption, selected && s.soundOptionSelected]}
                    onPress={() => chooseAlertSound(value)}
                  >
                    <Text style={[s.soundOptionText, selected && s.soundOptionTextSelected]}>{profile.label}</Text>
                    <Text style={s.soundOptionSub}>{profile.description}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.soundNote}>{strings.settings.alerts.soundLimits}</Text>
          </View>
          <View style={s.alertSafetyNote}>
            <Ionicons name="shield-checkmark-outline" size={15} color={colors.amber} />
            <Text style={s.alertSafetyText}>{strings.settings.alerts.safetyLimits}</Text>
          </View>
        </View>
        <View style={s.card}>
          <Text style={s.cardTitle}>{strings.settings.connections.title}</Text>
          <View accessibilityLiveRegion="polite" style={s.deviceSummary}>
            <View style={s.deviceSummaryIcon}>
              <Ionicons name="checkmark-done-outline" size={18} color={colors.green} />
            </View>
            <View style={s.deviceSummaryCopy}>
              <Text style={s.deviceSummaryTitle}>{strings.settings.connections.readinessTitle}</Text>
              <Text style={s.deviceSummaryText}>{deviceReadinessSummary}</Text>
            </View>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityHint={strings.settings.connections.refreshHint}
            accessibilityState={{ disabled: deviceRefreshBusy, busy: deviceRefreshBusy }}
            disabled={deviceRefreshBusy}
            onPress={refreshConnectedDevices}
            style={[s.refreshRow, deviceRefreshBusy && s.testRowDisabled]}
          >
            <Ionicons name="refresh" size={16} color={colors.cyan} />
            <Text style={s.refreshText}>{deviceRefreshBusy ? strings.settings.connections.refreshing : strings.settings.connections.refreshAction}</Text>
          </TouchableOpacity>
          <View style={s.div} />
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="headset-outline" size={18} color="#60a5fa" />
              <View style={s.rowCopy}>
                <Text style={s.label}>{strings.settings.headphones.audioTitle}</Text>
                <Text style={s.sub}>{strings.settings.headphones.audioDetail}</Text>
              </View>
            </View>
            <Text style={s.status}>{strings.settings.headphones.audioStatus}</Text>
          </View>
          <View style={s.div} />
          <TouchableOpacity
            accessibilityHint={strings.settings.audioTest.hint}
            accessibilityRole="button"
            accessibilityLabel={audioTestBusy ? strings.settings.audioTest.preparingAccessibility : strings.settings.audioTest.accessibility}
            accessibilityState={{ disabled: audioTestBusy, busy: audioTestBusy }}
            disabled={audioTestBusy}
            style={[s.testRow, audioTestBusy && s.testRowDisabled]}
            onPress={testAudioOutput}
          >
            <Ionicons name="volume-high-outline" size={17} color="#60a5fa" />
            <Text style={s.testText}>
              {audioTestBusy ? strings.settings.audioTest.preparing : strings.settings.audioTest.action}
            </Text>
          </TouchableOpacity>
          <Text style={s.testNote}>{strings.settings.audioTest.parkedDetail}</Text>
          <TouchableOpacity
            accessibilityHint={strings.settings.hapticTest.hint}
            accessibilityRole="button"
            accessibilityLabel={strings.settings.hapticTest.accessibility}
            style={s.testRow}
            onPress={testHapticOutput}
          >
            <Ionicons name="phone-portrait-outline" size={17} color="#60a5fa" />
            <Text style={s.testText}>{strings.settings.hapticTest.action}</Text>
          </TouchableOpacity>
          <Text style={s.testNote}>{strings.settings.hapticTest.parkedDetail}</Text>
          <View style={s.div} />
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="pulse-outline" size={18} color="#60a5fa" />
              <View style={s.rowCopy}>
                <Text style={s.label}>{strings.settings.headphoneMotion.title}</Text>
                <Text style={s.sub}>{headphoneMotionDescription}</Text>
              </View>
            </View>
            <Text style={s.status}>{headphoneMotionLabel}</Text>
          </View>
          <View style={s.div} />
          <View style={s.patternBlock}>
            <View style={s.rowL}>
              <Ionicons name="ear-outline" size={18} color="#60a5fa" />
              <View style={s.rowCopy}>
                <Text style={s.label}>{strings.settings.headphones.patternTitle}</Text>
                <Text style={s.sub}>{strings.settings.headphones.patternDetail}</Text>
              </View>
            </View>
            <View style={s.patternOptions}>
              {([
                ['balanced', strings.settings.headphones.pattern.centered],
                ['alternating', strings.settings.headphones.pattern.alternating],
              ] as const).map(([value, label]) => {
                const selected = inEarPattern === value;
                return (
                  <TouchableOpacity
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={formatString(strings.settings.headphones.patternAccessibility, { pattern: label })}
                    accessibilityHint={strings.settings.headphones.patternHint}
                    accessibilityState={{ selected }}
                    style={[s.patternOption, selected && s.patternOptionSelected]}
                    onPress={() => chooseInEarPattern(value)}
                  >
                    <Text style={[s.patternOptionText, selected && s.patternOptionTextSelected]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.patternNote}>{strings.settings.headphones.patternLimits}</Text>
          </View>
          <View style={s.div} />
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="watch-outline" size={18} color="#60a5fa" />
              <View style={s.rowCopy}>
                <Text style={s.label}>{strings.settings.watch.title}</Text>
                <Text style={s.sub}>{watchDescription}</Text>
              </View>
            </View>
            <Switch accessibilityLabel={strings.settings.watch.title} accessibilityHint={strings.settings.watch.toggleHint} disabled={!watchAvailable} value={watch && watchAvailable} onValueChange={changeWatchAlerts} trackColor={{ true: '#2563eb', false: '#1a3a4a' }} thumbColor="#fff" />
          </View>
          <View style={s.div} />
          <TouchableOpacity
            accessibilityHint={strings.settings.watch.test.hint}
            accessibilityRole="button"
            accessibilityState={{ disabled: !watchAvailable || !watch || watchTestBusy, busy: watchTestBusy }}
            disabled={!watchAvailable || !watch || watchTestBusy}
            style={[s.testRow, (!watchAvailable || !watch || watchTestBusy) && s.testRowDisabled]}
            onPress={testWatchAlert}
          >
            <Ionicons name="pulse-outline" size={17} color="#60a5fa" />
            <Text style={s.testText}>
              {watchTestBusy ? strings.settings.watch.test.sending : strings.settings.watch.test.action}
            </Text>
          </TouchableOpacity>
        </View>
        <CloudSyncCard />
        <View style={s.card}>
          <Text style={s.cardTitle}>{strings.settings.localData.title}</Text>
          <View style={s.privacySummary}>
            <View style={s.privacySummaryIcon}>
              <Ionicons name="phone-portrait-outline" size={19} color={colors.green} />
            </View>
            <View style={s.rowCopy}>
              <Text style={s.privacySummaryTitle}>{strings.settings.localData.storedTitle}</Text>
              <Text style={s.privacySummaryText}>{strings.settings.localData.storedDetail}</Text>
            </View>
          </View>
          <View style={s.privNote}>
            <Ionicons name="eye-off-outline" size={14} color="#4a7a8a" />
            <Text style={s.privTxt}>{strings.settings.localData.privacyDetail}</Text>
          </View>
          <View style={s.privNote}>
            <Ionicons name="cloud-outline" size={14} color="#4a7a8a" />
            <Text style={s.privTxt}>{strings.settings.localData.cloudDetail}</Text>
          </View>
          <View style={s.privNote}>
            <Ionicons name="time-outline" size={14} color="#4a7a8a" />
            <Text style={s.privTxt}>{strings.settings.localData.retentionDetail}</Text>
          </View>
          <View accessibilityLiveRegion="polite" style={s.localDataStatus}>
            <Text style={s.localDataStatusText}>
              {localDataStatusBusy
                ? strings.settings.localData.historyChecking
                : localSessionCount === null
                  ? strings.settings.localData.historyUnavailable
                  : formatString(localSessionCount === 1 ? strings.settings.localData.sessionCountOne : strings.settings.localData.sessionCountMany, { count: localSessionCount })}
            </Text>
            <Text style={s.localDataStatusText}>
              {localDataStatusBusy
                ? strings.settings.localData.recovery.checking
                : recoveryDataUnreadable
                  ? strings.settings.localData.recovery.unreadable
                : recoveryDataPresent === null
                  ? strings.settings.localData.recovery.unavailable
                  : recoveryDataPresent ? strings.settings.localData.recovery.saved : strings.settings.localData.recovery.none}
            </Text>
            {!localDataStatusBusy && (localSessionCount === null || recoveryDataPresent === null) && (
              <>
                <Text style={s.localDataStatusError}>
                  {recoveryDataUnreadable
                    ? strings.settings.localData.recovery.unreadableDetail
                    : strings.settings.localData.unconfirmedDetail}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={strings.settings.localData.retryAccessibility}
                  accessibilityHint={strings.settings.localData.retryHint}
                  onPress={refreshLocalDataStatus}
                  style={s.localDataRetry}
                >
                  <Ionicons name="refresh" size={15} color={colors.cyan} />
                  <Text style={s.localDataRetryText}>{strings.settings.localData.retryAction}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={strings.settings.localData.review.accessibility}
            accessibilityHint={strings.settings.localData.review.hint}
            accessibilityState={{ disabled: localDataBusy, busy: localDataBusy }}
            disabled={localDataBusy}
            onPress={() => router.push('/history')}
            style={[s.localDataAction, localDataBusy && s.localDataActionDisabled]}
          >
            <Ionicons name="share-outline" size={17} color="#93c5fd" />
            <View style={s.rowCopy}>
              <Text style={s.localDataReviewTitle}>{strings.settings.localData.review.title}</Text>
              <Text style={s.localDataActionDetail}>{strings.settings.localData.review.detail}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#4a7a8a" />
          </TouchableOpacity>
          <View style={s.div} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={strings.settings.localData.delete.accessibility}
            accessibilityHint={strings.settings.localData.delete.hint}
            accessibilityState={{ disabled: localHistoryDeleteDisabled, busy: localDataBusy || localDataStatusBusy }}
            disabled={localHistoryDeleteDisabled}
            onPress={confirmDeleteAllLocalSessions}
            style={[s.localDataAction, localHistoryDeleteDisabled && s.localDataActionDisabled]}
          >
            <Ionicons name="trash-outline" size={17} color="#fca5a5" />
            <View style={s.rowCopy}>
              <Text style={s.localDataActionTitle}>{strings.settings.localData.delete.accessibility}</Text>
              <Text style={s.localDataActionDetail}>{strings.settings.localData.delete.detail}</Text>
            </View>
          </TouchableOpacity>
          <View style={s.div} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={strings.settings.localData.recovery.accessibility}
            accessibilityHint={strings.settings.localData.recovery.hint}
            accessibilityState={{ disabled: recoveryDeleteDisabled, busy: localDataBusy || localDataStatusBusy }}
            disabled={recoveryDeleteDisabled}
            onPress={confirmClearRecoveryData}
            style={[s.localDataAction, recoveryDeleteDisabled && s.localDataActionDisabled]}
          >
            <Ionicons name="refresh-circle-outline" size={18} color="#fca5a5" />
            <View style={s.rowCopy}>
              <Text style={s.localDataActionTitle}>{strings.settings.localData.recovery.accessibility}</Text>
              <Text style={s.localDataActionDetail}>{recoveryDataUnreadable
                ? strings.settings.localData.recovery.unreadableActionDetail
                : strings.settings.localData.recovery.actionDetail}</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={s.card}>
          <Text style={s.cardTitle}>{strings.settings.support.title}</Text>
          <TouchableOpacity
            accessibilityRole="link"
            accessibilityLabel={strings.settings.support.helpTitle}
            accessibilityHint={strings.settings.support.helpHint}
            style={s.row}
            onPress={() => { void openSupportPage(); }}
          >
            <View style={s.rowL}><Ionicons name="help-circle-outline" size={18} color="#60a5fa" /><View style={s.rowCopy}><Text style={s.label}>{strings.settings.support.helpTitle}</Text><Text style={s.sub}>{strings.settings.support.helpDetail}</Text></View></View>
            <Ionicons name="open-outline" size={18} color="#4a7a8a" />
          </TouchableOpacity>
          <View style={s.div} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={feedbackBusy ? strings.settings.feedback.preparingAccessibility : strings.settings.feedback.accessibility}
            accessibilityHint={strings.settings.feedback.hint}
            accessibilityState={{ disabled: feedbackBusy, busy: feedbackBusy }}
            disabled={feedbackBusy}
            style={[s.row, feedbackBusy && s.localDataActionDisabled]}
            onPress={sendFeedback}
          >
            <View style={s.rowL}><Ionicons name="chatbubble-ellipses-outline" size={18} color="#60a5fa" /><View style={s.rowCopy}><Text style={s.label}>{feedbackBusy ? strings.settings.feedback.preparing : strings.settings.feedback.action}</Text><Text style={s.sub}>{strings.settings.feedback.detail}</Text></View></View>
            <Ionicons name="chevron-forward" size={18} color="#4a7a8a" />
          </TouchableOpacity>
          <View style={s.privNote}><Ionicons name="lock-closed-outline" size={13} color="#4a7a8a" /><Text style={s.privTxt}>{strings.settings.feedback.privacyDetail}</Text></View>
        </View>
        <Text accessibilityLabel={formatString(strings.settings.footer.accessibility, { build: appBuildLabel })} style={s.ver}>
          {formatString(strings.settings.footer.text, { build: appBuildLabel })}
        </Text>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  bg:{flex:1,backgroundColor:colors.background}, keyboard:{flex:1}, scroll:{padding:20,paddingBottom:48},
  eyebrow:{color:colors.cyan,fontSize:10,fontWeight:'800',letterSpacing:1.5,marginTop:6,marginBottom:5},
  title:{color:colors.text,fontSize:32,fontWeight:'800',letterSpacing:-0.8,marginBottom:12},
  priorityCard:{flexDirection:'row',alignItems:'flex-start',gap:11,backgroundColor:'rgba(100,210,255,0.07)',borderWidth:1,borderColor:'rgba(100,210,255,0.2)',borderRadius:radii.medium,padding:14,marginBottom:18},
  priorityIcon:{width:36,height:36,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(100,210,255,0.1)'},
  priorityCopy:{flex:1},
  priorityTitle:{color:colors.text,fontSize:13,fontWeight:'800'},
  priorityText:{color:colors.textSecondary,fontSize:11,lineHeight:16,marginTop:3},
  card:{backgroundColor:colors.material,borderWidth:1,borderColor:colors.glassBorder,borderRadius:radii.large,marginBottom:16,overflow:'hidden'},
  cardTitle:{color:colors.textSecondary,fontSize:11,fontWeight:'800',letterSpacing:0.8,textTransform:'uppercase',padding:14,borderBottomWidth:1,borderColor:'rgba(255,255,255,0.08)'},
  row:{minHeight:52,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,gap:12},
  rowL:{minWidth:0,flexDirection:'row',alignItems:'center',gap:12,flex:1},
  rowCopy:{minWidth:0,flex:1},
  label:{color:colors.text,fontSize:14,fontWeight:'700'}, sub:{color:colors.textMuted,fontSize:11,lineHeight:16,marginTop:2},
  status:{flexShrink:1,color:colors.cyan,fontSize:10,fontWeight:'900',letterSpacing:0.6,textAlign:'right'},
  deviceSummary:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,paddingTop:14,paddingBottom:10,backgroundColor:'rgba(48,209,88,0.05)'},
  deviceSummaryIcon:{width:34,height:34,borderRadius:11,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(48,209,88,0.1)'},
  deviceSummaryCopy:{flex:1},
  deviceSummaryTitle:{color:'#bbf7d0',fontSize:12,fontWeight:'900'},
  deviceSummaryText:{color:colors.textSecondary,fontSize:10,lineHeight:15,marginTop:2},
  refreshRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingHorizontal:16},
  refreshText:{color:colors.cyan,fontSize:11,fontWeight:'900',letterSpacing:0.55},
  div:{height:1,backgroundColor:colors.glassBorder,marginHorizontal:16},
  testRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingVertical:13,paddingHorizontal:12},
  testRowDisabled:{opacity:0.35},
  testText:{color:'#60a5fa',fontSize:13,fontWeight:'800'},
  testNote:{color:colors.textMuted,fontSize:10,lineHeight:15,textAlign:'center',paddingHorizontal:16,paddingBottom:12},
  alertSafetyNote:{flexDirection:'row',alignItems:'flex-start',gap:8,paddingHorizontal:16,paddingVertical:13,backgroundColor:'rgba(251,191,36,0.07)',borderTopWidth:1,borderColor:'rgba(251,191,36,0.16)'},
  alertSafetyText:{flex:1,color:'#f8d98b',fontSize:11,lineHeight:16},
  patternBlock:{paddingHorizontal:16,paddingVertical:14,gap:12},
  patternOptions:{flexDirection:'row',flexWrap:'wrap',gap:8},
  patternOption:{flexGrow:1,flexBasis:130,minHeight:44,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.glassBorder,borderRadius:radii.small,paddingVertical:10,backgroundColor:colors.backgroundRaised},
  patternOptionSelected:{borderColor:colors.blue,backgroundColor:'rgba(94,156,255,0.18)'},
  patternOptionText:{color:'#7f9ba8',fontSize:12,fontWeight:'800'},
  patternOptionTextSelected:{color:'#bfdbfe'},
  patternNote:{color:colors.textMuted,fontSize:11,lineHeight:16},
  soundBlock:{paddingHorizontal:16,paddingVertical:14,gap:12},
  soundOptions:{flexDirection:'row',flexWrap:'wrap',gap:8},
  soundOption:{flexGrow:1,flexBasis:130,minHeight:52,justifyContent:'center',borderWidth:1,borderColor:colors.glassBorder,borderRadius:radii.small,paddingVertical:10,paddingHorizontal:8,backgroundColor:colors.backgroundRaised},
  soundOptionSelected:{borderColor:colors.blue,backgroundColor:'rgba(94,156,255,0.18)'},
  soundOptionText:{color:'#7f9ba8',fontSize:12,fontWeight:'800',textAlign:'center'},
  soundOptionTextSelected:{color:'#bfdbfe'},
  soundOptionSub:{color:colors.textMuted,fontSize:9,lineHeight:12,textAlign:'center',marginTop:3},
  soundNote:{color:colors.textMuted,fontSize:11,lineHeight:16},
  privNote:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:14,backgroundColor:colors.backgroundRaised,borderTopWidth:1,borderColor:colors.glassBorder},
  privTxt:{color:colors.textMuted,fontSize:11,lineHeight:16,flex:1},
  privacySummary:{flexDirection:'row',alignItems:'flex-start',gap:11,padding:16,backgroundColor:'rgba(48,209,88,0.05)'},
  privacySummaryIcon:{width:36,height:36,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(48,209,88,0.1)'},
  privacySummaryTitle:{color:'#bbf7d0',fontSize:13,fontWeight:'900'},
  privacySummaryText:{color:colors.textSecondary,fontSize:11,lineHeight:17,marginTop:3},
  localDataStatus:{gap:4,paddingHorizontal:16,paddingVertical:12,borderTopWidth:1,borderColor:colors.glassBorder},
  localDataStatusText:{color:colors.textSecondary,fontSize:11,lineHeight:16},
  localDataStatusError:{color:'#f8d98b',fontSize:11,lineHeight:16,marginTop:5},
  localDataRetry:{alignSelf:'flex-start',minHeight:44,flexDirection:'row',alignItems:'center',gap:7,paddingRight:16},
  localDataRetryText:{color:colors.cyan,fontSize:11,fontWeight:'900',letterSpacing:0.55},
  localDataAction:{minHeight:64,flexDirection:'row',alignItems:'flex-start',gap:11,paddingHorizontal:16,paddingVertical:14},
  localDataActionDisabled:{opacity:0.4},
  localDataReviewTitle:{color:'#bfdbfe',fontSize:13,fontWeight:'800'},
  localDataActionTitle:{color:'#fca5a5',fontSize:13,fontWeight:'800'},
  localDataActionDetail:{color:colors.textMuted,fontSize:11,lineHeight:16,marginTop:3},
  ver:{textAlign:'center',color:colors.textMuted,fontSize:11,marginTop:8},
});
