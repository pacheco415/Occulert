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
  HAPTIC_ALERT_PREFERENCE_KEY,
  IN_EAR_ALERT_PREFERENCE_KEY,
  alertPreferenceStorage,
  loadAlertPreferences,
} from '../lib/alertPreferences';
import { alertDeliveryPlan } from '../lib/alertDelivery';
import { waitForCancellableDelay } from '../lib/cancellableDelay';

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
  const [inEarPattern, setInEarPattern] = useState<InEarAlertPattern>('balanced');
  const [watch, setWatch] = useState(false);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>(EMPTY_WATCH_STATUS);
  const [headphoneMotionStatus, setHeadphoneMotionStatus] = useState<HeadphoneMotionStatus>(
    EMPTY_HEADPHONE_MOTION_STATUS,
  );
  const [audioTestBusy, setAudioTestBusy] = useState(false);
  const [watchTestBusy, setWatchTestBusy] = useState(false);
  // This parked-only test must release the shared iOS audio session when the
  // tone ends so music and navigation audio can return to their normal level.
  const audioTestPlayer = useAudioPlayer(ALERT_SOUND);
  const audioTestRunnerRef = useRef(createSingleFlightActionRunner());
  const watchTestRunnerRef = useRef(createSingleFlightActionRunner());
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
      ? 'No Apple Watch is paired'
      : !watchStatus.appInstalled
        ? 'Install the Occulert Watch app to enable wrist alerts'
        : watchStatus.reachable
          ? 'Connected — enable background alerts in the Watch app'
          : 'Companion installed — open it to finish wrist alert setup';

  const headphoneMotionDescription = describeHeadphoneMotion(headphoneMotionStatus);
  const headphoneMotionLabel = labelHeadphoneMotion(headphoneMotionStatus);

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
            audioTestPlayer.volume = 0.85;
            audioTestPlayer.play();
            previousOffset = offset;
          }
          await waitForCancellableDelay(ALERT_SOUND_DURATION_MS, controller.signal);
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
        } else if (result.reachable) {
          Alert.alert('Watch test sent', 'Check your Apple Watch for the alert and wrist tap.');
        } else {
          Alert.alert('Watch test queued', 'Open Occulert on your Apple Watch and enable background alerts. Queued delivery may be delayed.');
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

  return (
    <SafeAreaView style={s.bg}>
      <AmbientBackground />
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.eyebrow}>OCCULERT</Text>
        <Text style={s.title}>Settings</Text>
        <SensitivitySlider value={sens} onChange={setSens} />
        <View style={s.card}>
          <Text style={s.cardTitle}>ALERTS</Text>
          <View style={s.row}>
            <View style={s.rowL}><Ionicons name="phone-portrait-outline" size={18} color="#60a5fa" /><View><Text style={s.label}>Haptic vibration</Text><Text style={s.sub}>Vibrate on alert</Text></View></View>
            <Switch value={haptic} onValueChange={v=>saveBooleanSetting(HAPTIC_ALERT_PREFERENCE_KEY,v,haptic,setHaptic)} trackColor={{true:'#2563eb',false:'#1a3a4a'}} thumbColor="#fff" />
          </View>
          <View style={s.div}/>
          <View style={s.row}>
            <View style={s.rowL}><Ionicons name="volume-high-outline" size={18} color="#60a5fa" /><View><Text style={s.label}>Audio tone</Text><Text style={s.sub}>Sound on alert</Text></View></View>
            <Switch value={audio} onValueChange={v=>saveBooleanSetting(AUDIO_ALERT_PREFERENCE_KEY,v,audio,setAudio)} trackColor={{true:'#2563eb',false:'#1a3a4a'}} thumbColor="#fff" />
          </View>
          <View style={s.alertSafetyNote}>
            <Ionicons name="shield-checkmark-outline" size={15} color={colors.amber} />
            <Text style={s.alertSafetyText}>Standard alerts repeat twice and critical alerts repeat three times on each enabled output. Alerts cannot make drowsy driving safe—pull over and rest.</Text>
          </View>
        </View>
        <View style={s.card}>
          <Text style={s.cardTitle}>CONNECTED DEVICES</Text>
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
            disabled={audioTestBusy}
            style={[s.testRow, audioTestBusy && s.testRowDisabled]}
            onPress={testAudioOutput}
          >
            <Ionicons name="volume-high-outline" size={17} color="#60a5fa" />
            <Text style={s.testText}>
              {audioTestBusy ? 'PREPARING AUDIO TEST…' : 'TEST CURRENT AUDIO OUTPUT'}
            </Text>
          </TouchableOpacity>
          <Text style={s.testNote}>Use only while parked. This plays the centered three-tone critical sequence and does not change your alert setting.</Text>
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
              <View>
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
              <View>
                <Text style={s.label}>Apple Watch alerts</Text>
                <Text style={s.sub}>{watchDescription}</Text>
              </View>
            </View>
            <Switch disabled={!watchAvailable} value={watch && watchAvailable} onValueChange={changeWatchAlerts} trackColor={{ true: '#2563eb', false: '#1a3a4a' }} thumbColor="#fff" />
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
          <Text style={s.cardTitle}>PILOT SUPPORT</Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={s.row}
            onPress={async () => {
              if (!await openFeedback()) {
                Alert.alert('Mail is unavailable', 'Email hello@occulert.com to share pilot feedback.');
              }
            }}
          >
            <View style={s.rowL}><Ionicons name="chatbubble-ellipses-outline" size={18} color="#60a5fa" /><View><Text style={s.label}>Send feedback</Text><Text style={s.sub}>Report an alert issue or share a suggestion</Text></View></View>
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
  title:{color:colors.text,fontSize:32,fontWeight:'800',letterSpacing:-0.8,marginBottom:22},
  card:{backgroundColor:colors.material,borderWidth:1,borderColor:colors.glassBorder,borderRadius:radii.large,marginBottom:16,overflow:'hidden'},
  cardTitle:{color:colors.textSecondary,fontSize:11,fontWeight:'800',letterSpacing:0.8,textTransform:'uppercase',padding:14,borderBottomWidth:1,borderColor:'rgba(255,255,255,0.08)'},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,gap:12},
  rowL:{flexDirection:'row',alignItems:'center',gap:12,flex:1},
  rowCopy:{flex:1},
  label:{color:colors.text,fontSize:14,fontWeight:'700'}, sub:{color:colors.textMuted,fontSize:11,marginTop:2},
  status:{color:colors.cyan,fontSize:10,fontWeight:'900',letterSpacing:0.6},
  div:{height:1,backgroundColor:colors.glassBorder,marginHorizontal:16},
  testRow:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingVertical:13},
  testRowDisabled:{opacity:0.35},
  testText:{color:'#60a5fa',fontSize:13,fontWeight:'800'},
  testNote:{color:colors.textMuted,fontSize:10,lineHeight:15,textAlign:'center',paddingHorizontal:16,paddingBottom:12},
  alertSafetyNote:{flexDirection:'row',alignItems:'flex-start',gap:8,paddingHorizontal:16,paddingVertical:13,backgroundColor:'rgba(251,191,36,0.07)',borderTopWidth:1,borderColor:'rgba(251,191,36,0.16)'},
  alertSafetyText:{flex:1,color:'#f8d98b',fontSize:11,lineHeight:16},
  patternBlock:{paddingHorizontal:16,paddingVertical:14,gap:12},
  patternOptions:{flexDirection:'row',gap:8},
  patternOption:{flex:1,alignItems:'center',borderWidth:1,borderColor:colors.glassBorder,borderRadius:radii.small,paddingVertical:10,backgroundColor:colors.backgroundRaised},
  patternOptionSelected:{borderColor:colors.blue,backgroundColor:'rgba(94,156,255,0.18)'},
  patternOptionText:{color:'#7f9ba8',fontSize:12,fontWeight:'800'},
  patternOptionTextSelected:{color:'#bfdbfe'},
  patternNote:{color:colors.textMuted,fontSize:11,lineHeight:16},
  privNote:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:14,backgroundColor:colors.backgroundRaised,borderTopWidth:1,borderColor:colors.glassBorder},
  privTxt:{color:colors.textMuted,fontSize:11,lineHeight:16,flex:1},
  ver:{textAlign:'center',color:colors.textMuted,fontSize:11,marginTop:8},
});
