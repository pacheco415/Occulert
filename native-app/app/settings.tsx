import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Switch, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import { SensitivitySlider, loadSavedSensitivity } from '../components/SensitivitySlider';
import type { SensitivityLevel } from '../constants/thresholds';
import { openFeedback } from '../lib/feedback';
import { getWatchStatus, sendAlertToWatch, type WatchStatus } from '../lib/watchBridge';
import {
  getWatchAlertsEnabled,
  setWatchAlertsEnabled,
  WATCH_ALERTS_PREFERENCE_KEY,
} from '../lib/watchPreferences';
import { CloudSyncCard } from '../components/CloudSyncCard';
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
import { clearActiveSessionCheckpoint, loadActiveSessionCheckpoint } from '../lib/sessionRecovery';

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
    'Could not save setting',
    'Your previous setting is still active. Please try again.',
  );
};

const describeHeadphoneMotion = (status: HeadphoneMotionStatus): string => {
  switch (status.state) {
    case 'active':
      return 'Receiving compatible-headphone motion during monitoring';
    case 'starting':
      return 'Starting compatible-headphone motion…';
    case 'stopped':
      return status.authorization === 'notDetermined'
        ? 'Available — iOS may request Motion access when monitoring starts'
        : 'Available — starts automatically with monitoring';
    case 'denied':
      return 'Motion access is denied in iPhone Settings';
    case 'unavailable':
      return 'Connect compatible AirPods or Beats to enable motion observations';
    case 'error':
      return 'Motion status could not be confirmed';
    default:
      return 'Headphone motion support is unavailable in this build';
  }
};

const labelHeadphoneMotion = (status: HeadphoneMotionStatus): string => {
  switch (status.state) {
    case 'active': return 'ACTIVE';
    case 'starting': return 'STARTING';
    case 'stopped': return 'READY';
    case 'denied': return 'DENIED';
    case 'unavailable': return 'NOT CONNECTED';
    case 'error': return 'CHECK';
    default: return 'UNAVAILABLE';
  }
};

export default function SettingsScreen() {
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
  const [localDataBusy, setLocalDataBusy] = useState(false);
  // This parked-only test must release the shared iOS audio session when the
  // tone ends so music and navigation audio can return to their normal level.
  const audioTestPlayer = useAudioPlayer(ALERT_SOUND);
  const audioTestRunnerRef = useRef(createSingleFlightActionRunner());
  const watchTestRunnerRef = useRef(createSingleFlightActionRunner());
  const deviceRefreshRunnerRef = useRef(createSingleFlightActionRunner());
  const settingsMountedRef = useRef(true);
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

  useFocusEffect(useCallback(() => {
    let active = true;
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
    Promise.all([
      loadSessionHistory(),
      loadActiveSessionCheckpoint(),
    ]).then(([sessions, checkpoint]) => {
      if (!active) return;
      setLocalSessionCount(sessions.length);
      setRecoveryDataPresent(Boolean(checkpoint));
    }).catch(() => {
      if (!active) return;
      setLocalSessionCount(null);
      setRecoveryDataPresent(null);
    });
    return () => { active = false; };
  }, []));

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
    ? 'Watch support is unavailable in this build'
    : !watchStatus.paired
      ? 'Open Occulert on your Watch, then refresh connections'
      : !watchStatus.appInstalled
        ? 'Open the Watch companion to confirm installation'
        : watchStatus.reachable
          ? 'Connected — enable background alerts in the Watch app'
          : 'Companion installed — open it to finish wrist alert setup';

  const headphoneMotionDescription = describeHeadphoneMotion(headphoneMotionStatus);
  const headphoneMotionLabel = labelHeadphoneMotion(headphoneMotionStatus);
  const deviceReadinessSummary = watchAvailable
    ? watch
      ? 'Phone alert tests available · Watch alerts enabled'
      : 'Phone alert tests available · Watch available but disabled'
    : 'Phone alert tests available · Open Watch app, then refresh';

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
        Alert.alert('Connections could not refresh', 'Check the optional devices and try again while parked.');
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
          'Audio test unavailable',
          'Check the iPhone volume and selected audio output, then try again while safely parked.',
        );
      },
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
          Alert.alert('Watch unavailable', 'Open Occulert on your Apple Watch, then try again.');
        } else if (result.acknowledged) {
          const timing = result.roundTripMs === null ? '' : ` in ${result.roundTripMs} ms`;
          Alert.alert(
            'Watch test received',
            `Your Apple Watch acknowledged the live alert${timing}. The iPhone remains the primary safety alert.`,
          );
        } else if (result.reachable) {
          Alert.alert(
            'Watch test sent',
            'The Watch was reachable but did not acknowledge the live message. Treat the iPhone as the primary alert.',
          );
        } else {
          Alert.alert(
            'Watch backup saved',
            'Background delivery may be delayed. Open Occulert on your Apple Watch for live wrist alerts; the iPhone remains primary.',
          );
        }
      },
      onBusyChange: busy => {
        if (settingsMountedRef.current) setWatchTestBusy(busy);
      },
      onError: () => {
        if (!settingsMountedRef.current) return;
        Alert.alert('Watch test unavailable', 'Check the Watch connection, then try again while safely parked.');
      },
    });
  };

  const deleteAllLocalSessions = async () => {
    if (localDataBusy) return;
    setLocalDataBusy(true);
    try {
      await clearSessionHistory();
      if (settingsMountedRef.current) setLocalSessionCount(0);
      Alert.alert(
        'Local history deleted',
        'Session summaries were removed from this iPhone. Any separately synced cloud records were not changed.',
      );
    } catch {
      Alert.alert('Could not delete local history', 'Your local session summaries remain saved. Please try again.');
    } finally {
      if (settingsMountedRef.current) setLocalDataBusy(false);
    }
  };

  const confirmDeleteAllLocalSessions = () => {
    Alert.alert(
      'Delete all local session history?',
      'This permanently removes every local session summary, review, and diagnostic from this iPhone. Cloud records are not changed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete All', style: 'destructive', onPress: () => { void deleteAllLocalSessions(); } },
      ],
    );
  };

  const clearRecoveryData = async () => {
    if (localDataBusy) return;
    setLocalDataBusy(true);
    try {
      await clearActiveSessionCheckpoint();
      if (settingsMountedRef.current) setRecoveryDataPresent(false);
      Alert.alert('Recovery data cleared', 'The interrupted-drive checkpoint was removed from this iPhone.');
    } catch {
      Alert.alert('Could not clear recovery data', 'The recovery checkpoint remains saved. Please try again.');
    } finally {
      if (settingsMountedRef.current) setLocalDataBusy(false);
    }
  };

  const confirmClearRecoveryData = () => {
    Alert.alert(
      'Clear interrupted-drive recovery data?',
      'This removes the temporary local checkpoint used to recover an interrupted monitoring session. Existing session history is not changed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => { void clearRecoveryData(); } },
      ],
    );
  };

  return (
    <SafeAreaView style={s.bg}>
      <AmbientBackground />
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.eyebrow}>OCCULERT</Text>
        <Text style={s.title}>Settings</Text>
        <View style={s.priorityCard}>
          <View style={s.priorityIcon}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.cyan} />
          </View>
          <View style={s.priorityCopy}>
            <Text style={s.priorityTitle}>Keep the core setup simple</Text>
            <Text style={s.priorityText}>The iPhone camera and at least one phone alert are the primary setup. Watch, headphones, Health, and cloud sync are optional additions.</Text>
          </View>
        </View>
        <SensitivitySlider value={sens} onChange={setSens} />
        <View style={s.card}>
          <Text style={s.cardTitle}>ALERTS</Text>
          <View style={s.row}>
            <View style={s.rowL}><Ionicons name="phone-portrait-outline" size={18} color="#60a5fa" /><View style={s.rowCopy}><Text style={s.label}>Haptic vibration</Text><Text style={s.sub}>Vibrate on alert</Text></View></View>
            <Switch accessibilityLabel="Haptic vibration alerts" accessibilityHint="Controls vibration from the iPhone during alerts" value={haptic} onValueChange={v=>saveBooleanSetting(HAPTIC_ALERT_PREFERENCE_KEY,v,haptic,setHaptic)} trackColor={{true:'#2563eb',false:'#1a3a4a'}} thumbColor="#fff" />
          </View>
          <View style={s.div}/>
          <View style={s.row}>
            <View style={s.rowL}><Ionicons name="volume-high-outline" size={18} color="#60a5fa" /><View style={s.rowCopy}><Text style={s.label}>Audio tone</Text><Text style={s.sub}>Sound on alert</Text></View></View>
            <Switch accessibilityLabel="Audio tone alerts" accessibilityHint="Controls alert sounds from the iPhone's current audio output" value={audio} onValueChange={v=>saveBooleanSetting(AUDIO_ALERT_PREFERENCE_KEY,v,audio,setAudio)} trackColor={{true:'#2563eb',false:'#1a3a4a'}} thumbColor="#fff" />
          </View>
          <View style={s.div}/>
          <View style={s.soundBlock}>
            <View style={s.rowL}>
              <Ionicons name="musical-notes-outline" size={18} color="#60a5fa" />
              <View style={s.rowCopy}>
                <Text style={s.label}>Alert sound</Text>
                <Text style={s.sub}>Choose the tone profile used for phone alerts</Text>
              </View>
            </View>
            <View style={s.soundOptions}>
              {ALERT_SOUND_OPTIONS.map(([value, profile]) => {
                const selected = alertSound === value;
                return (
                  <TouchableOpacity
                    key={value}
                    accessibilityLabel={`${profile.label} alert sound`}
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
            <Text style={s.soundNote}>This changes the tone profile only. Alert timing, severity, and centered critical delivery stay the same.</Text>
          </View>
          <View style={s.alertSafetyNote}>
            <Ionicons name="shield-checkmark-outline" size={15} color={colors.amber} />
            <Text style={s.alertSafetyText}>A continuous closed-eye reading reaches the prominent alert at about 0.6 seconds and, after the startup warmup, the stronger stage at 1.2 seconds. Standard alerts repeat twice and critical alerts repeat three times on each enabled output. Audio and haptic choices also control the foreground-loss warning; keep at least one enabled. Alerts cannot make drowsy driving safe—pull over and rest.</Text>
          </View>
        </View>
        <View style={s.card}>
          <Text style={s.cardTitle}>CONNECTED DEVICES</Text>
          <View accessibilityLiveRegion="polite" style={s.deviceSummary}>
            <View style={s.deviceSummaryIcon}>
              <Ionicons name="checkmark-done-outline" size={18} color={colors.green} />
            </View>
            <View style={s.deviceSummaryCopy}>
              <Text style={s.deviceSummaryTitle}>Parked readiness check</Text>
              <Text style={s.deviceSummaryText}>{deviceReadinessSummary}</Text>
            </View>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityHint="Refreshes Apple Watch and compatible headphone connection status"
            accessibilityState={{ disabled: deviceRefreshBusy, busy: deviceRefreshBusy }}
            disabled={deviceRefreshBusy}
            onPress={refreshConnectedDevices}
            style={[s.refreshRow, deviceRefreshBusy && s.testRowDisabled]}
          >
            <Ionicons name="refresh" size={16} color={colors.cyan} />
            <Text style={s.refreshText}>{deviceRefreshBusy ? 'REFRESHING CONNECTIONS…' : 'REFRESH CONNECTIONS'}</Text>
          </TouchableOpacity>
          <View style={s.div} />
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="headset-outline" size={18} color="#60a5fa" />
              <View style={s.rowCopy}>
                <Text style={s.label}>AirPods / Bluetooth audio</Text>
                <Text style={s.sub}>Uses the iPhone's current audio output automatically</Text>
              </View>
            </View>
            <Text style={s.status}>AUTOMATIC</Text>
          </View>
          <View style={s.div} />
          <TouchableOpacity
            accessibilityHint="Plays the three-tone urgent alert sequence through the iPhone's current audio output"
            accessibilityRole="button"
            accessibilityLabel={audioTestBusy ? 'Preparing audio test' : 'Test current audio output'}
            accessibilityState={{ disabled: audioTestBusy, busy: audioTestBusy }}
            disabled={audioTestBusy}
            style={[s.testRow, audioTestBusy && s.testRowDisabled]}
            onPress={testAudioOutput}
          >
            <Ionicons name="volume-high-outline" size={17} color="#60a5fa" />
            <Text style={s.testText}>
              {audioTestBusy ? 'PREPARING AUDIO TEST…' : 'TEST CURRENT AUDIO OUTPUT'}
            </Text>
          </TouchableOpacity>
          <Text style={s.testNote}>Use only while parked. This plays the selected sound as the centered three-tone critical sequence and does not change your alert setting.</Text>
          <View style={s.div} />
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="pulse-outline" size={18} color="#60a5fa" />
              <View style={s.rowCopy}>
                <Text style={s.label}>Compatible headphone motion</Text>
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
                <Text style={s.label}>Headphone alert pattern</Text>
                <Text style={s.sub}>Balanced is clearest; optional stereo emphasis is available for early alerts</Text>
              </View>
            </View>
            <View style={s.patternOptions}>
              {([
                ['balanced', 'Centered'],
                ['alternating', 'Alternate L/R'],
              ] as const).map(([value, label]) => {
                const selected = inEarPattern === value;
                return (
                  <TouchableOpacity
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} headphone alert pattern`}
                    accessibilityHint="Changes stereo emphasis for early alerts only"
                    accessibilityState={{ selected }}
                    style={[s.patternOption, selected && s.patternOptionSelected]}
                    onPress={() => chooseInEarPattern(value)}
                  >
                    <Text style={[s.patternOptionText, selected && s.patternOptionTextSelected]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.patternNote}>Both ears remain audible. Critical and tracking-loss alerts stay centered.</Text>
          </View>
          <View style={s.div} />
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="watch-outline" size={18} color="#60a5fa" />
              <View style={s.rowCopy}>
                <Text style={s.label}>Apple Watch alerts</Text>
                <Text style={s.sub}>{watchDescription}</Text>
              </View>
            </View>
            <Switch accessibilityLabel="Apple Watch alerts" accessibilityHint="Controls optional alert delivery to the paired Apple Watch" disabled={!watchAvailable} value={watch && watchAvailable} onValueChange={changeWatchAlerts} trackColor={{ true: '#2563eb', false: '#1a3a4a' }} thumbColor="#fff" />
          </View>
          <View style={s.div} />
          <TouchableOpacity
            accessibilityHint="Sends one urgent-pattern test to the paired Apple Watch"
            accessibilityRole="button"
            accessibilityState={{ disabled: !watchAvailable || !watch || watchTestBusy, busy: watchTestBusy }}
            disabled={!watchAvailable || !watch || watchTestBusy}
            style={[s.testRow, (!watchAvailable || !watch || watchTestBusy) && s.testRowDisabled]}
            onPress={testWatchAlert}
          >
            <Ionicons name="pulse-outline" size={17} color="#60a5fa" />
            <Text style={s.testText}>
              {watchTestBusy ? 'SENDING WATCH TEST…' : 'Test Watch alert · urgent pattern'}
            </Text>
          </TouchableOpacity>
        </View>
        <CloudSyncCard />
        <View style={s.card}>
          <Text style={s.cardTitle}>PRIVACY &amp; LOCAL DATA</Text>
          <View style={s.privacySummary}>
            <View style={s.privacySummaryIcon}>
              <Ionicons name="phone-portrait-outline" size={19} color={colors.green} />
            </View>
            <View style={s.rowCopy}>
              <Text style={s.privacySummaryTitle}>Stored on this iPhone</Text>
              <Text style={s.privacySummaryText}>
                Session summaries, your reviews and test conditions, bounded performance diagnostics, preferences, and a temporary interrupted-drive checkpoint.
              </Text>
            </View>
          </View>
          <View style={s.privNote}>
            <Ionicons name="eye-off-outline" size={14} color="#4a7a8a" />
            <Text style={s.privTxt}>Occulert does not save camera video, photos, microphone audio, or a location route. Optional Apple Health context is a small local summary managed from the pre-drive screen.</Text>
          </View>
          <View style={s.privNote}>
            <Ionicons name="cloud-outline" size={14} color="#4a7a8a" />
            <Text style={s.privTxt}>Cloud session summaries are separate and sync only when you enable cloud sync while signed in. Deleting local data here does not delete cloud records.</Text>
          </View>
          <View accessibilityLiveRegion="polite" style={s.localDataStatus}>
            <Text style={s.localDataStatusText}>
              {localSessionCount === null ? 'Local history count unavailable' : `${localSessionCount} local ${localSessionCount === 1 ? 'session' : 'sessions'}`}
            </Text>
            <Text style={s.localDataStatusText}>
              {recoveryDataPresent === null ? 'Recovery status unavailable' : recoveryDataPresent ? 'Recovery checkpoint saved' : 'No recovery checkpoint'}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Delete all local session history"
            accessibilityHint="Permanently removes local session summaries after confirmation without changing cloud records"
            accessibilityState={{ disabled: localDataBusy || localSessionCount === 0, busy: localDataBusy }}
            disabled={localDataBusy || localSessionCount === 0}
            onPress={confirmDeleteAllLocalSessions}
            style={[s.localDataAction, (localDataBusy || localSessionCount === 0) && s.localDataActionDisabled]}
          >
            <Ionicons name="trash-outline" size={17} color="#fca5a5" />
            <View style={s.rowCopy}>
              <Text style={s.localDataActionTitle}>Delete all local session history</Text>
              <Text style={s.localDataActionDetail}>Removes summaries, reviews, test conditions, and diagnostics from this iPhone.</Text>
            </View>
          </TouchableOpacity>
          <View style={s.div} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Clear interrupted-drive recovery data"
            accessibilityHint="Removes the temporary local recovery checkpoint after confirmation"
            accessibilityState={{ disabled: localDataBusy || recoveryDataPresent === false, busy: localDataBusy }}
            disabled={localDataBusy || recoveryDataPresent === false}
            onPress={confirmClearRecoveryData}
            style={[s.localDataAction, (localDataBusy || recoveryDataPresent === false) && s.localDataActionDisabled]}
          >
            <Ionicons name="refresh-circle-outline" size={18} color="#fca5a5" />
            <View style={s.rowCopy}>
              <Text style={s.localDataActionTitle}>Clear interrupted-drive recovery data</Text>
              <Text style={s.localDataActionDetail}>Keeps existing session history and removes only the temporary checkpoint.</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={s.card}>
          <Text style={s.cardTitle}>PILOT SUPPORT</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Send pilot feedback"
            accessibilityHint="Opens a draft email for your review"
            style={s.row}
            onPress={async () => {
              if (!await openFeedback()) {
                Alert.alert('Mail is unavailable', 'Email hello@occulert.com to share pilot feedback.');
              }
            }}
          >
            <View style={s.rowL}><Ionicons name="chatbubble-ellipses-outline" size={18} color="#60a5fa" /><View style={s.rowCopy}><Text style={s.label}>Send feedback</Text><Text style={s.sub}>Report an alert issue or share a suggestion</Text></View></View>
            <Ionicons name="chevron-forward" size={18} color="#4a7a8a" />
          </TouchableOpacity>
          <View style={s.privNote}><Ionicons name="lock-closed-outline" size={13} color="#4a7a8a" /><Text style={s.privTxt}>Feedback opens in Mail for your review. No camera video, audio, or location is attached.</Text></View>
        </View>
        <Text accessibilityLabel={`Occulert ${appBuildLabel}`} style={s.ver}>
          Occulert™ · {appBuildLabel} · San Francisco, CA
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  bg:{flex:1,backgroundColor:colors.background}, scroll:{padding:20,paddingBottom:48},
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
  localDataAction:{minHeight:64,flexDirection:'row',alignItems:'flex-start',gap:11,paddingHorizontal:16,paddingVertical:14},
  localDataActionDisabled:{opacity:0.4},
  localDataActionTitle:{color:'#fca5a5',fontSize:13,fontWeight:'800'},
  localDataActionDetail:{color:colors.textMuted,fontSize:11,lineHeight:16,marginTop:3},
  ver:{textAlign:'center',color:colors.textMuted,fontSize:11,marginTop:8},
});
