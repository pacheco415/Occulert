import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Switch, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { SensitivitySlider, loadSavedSensitivity } from '../components/SensitivitySlider';
import type { SensitivityLevel } from '../constants/thresholds';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { openFeedback } from '../lib/feedback';
import { getWatchStatus, sendAlertToWatch, type WatchStatus } from '../lib/watchBridge';
import { getWatchAlertsEnabled, setWatchAlertsEnabled } from '../lib/watchPreferences';
import { CloudSyncCard } from '../components/CloudSyncCard';
import { AmbientBackground } from '../components/GlassSurface';
import { colors, radii } from '../constants/theme';
import { currentAppBuildInfo, formatAppBuildLabel } from '../lib/appBuildInfo';
import {
  IN_EAR_ALERT_PATTERN_KEY,
  parseInEarAlertPattern,
  type InEarAlertPattern,
} from '../lib/inEarAlerts';

const EMPTY_WATCH_STATUS: WatchStatus = {
  moduleAvailable: false,
  paired: false,
  appInstalled: false,
  reachable: false,
};

export default function SettingsScreen() {
  const [sens, setSens] = useState<SensitivityLevel>('medium');
  const [haptic, setHaptic] = useState(true);
  const [audio, setAudio] = useState(true);
  const [inEarPattern, setInEarPattern] = useState<InEarAlertPattern>('balanced');
  const [watch, setWatch] = useState(false);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>(EMPTY_WATCH_STATUS);
  const watchAvailable = watchStatus.paired && watchStatus.appInstalled;
  const appBuildLabel = formatAppBuildLabel(currentAppBuildInfo());

  useEffect(() => {
    let active = true;
    Promise.all([
      loadSavedSensitivity(),
      AsyncStorage.getItem('occulert-haptic'),
      AsyncStorage.getItem('occulert-audio'),
      AsyncStorage.getItem(IN_EAR_ALERT_PATTERN_KEY),
    ]).then(([savedSensitivity, savedHaptic, savedAudio, savedInEarPattern]) => {
      if (!active) return;
      setSens(savedSensitivity);
      if (savedHaptic != null) setHaptic(savedHaptic === 'true');
      if (savedAudio != null) setAudio(savedAudio === 'true');
      setInEarPattern(parseInEarAlertPattern(savedInEarPattern));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([
      getWatchStatus(),
      getWatchAlertsEnabled(true),
    ]).then(([status, saved]) => {
      if (!active) return;
      setWatchStatus(status);
      setWatch(saved);
    }).catch(() => {});
    return () => { active = false; };
  }, []));

  const tog = async (key: string, val: boolean, set: (v: boolean) => void) => {
    set(val); await AsyncStorage.setItem(key, String(val));
  };

  const chooseInEarPattern = async (pattern: InEarAlertPattern) => {
    setInEarPattern(pattern);
    await AsyncStorage.setItem(IN_EAR_ALERT_PATTERN_KEY, pattern);
  };

  const changeWatchAlerts = async (enabled: boolean) => {
    setWatch(enabled);
    await setWatchAlertsEnabled(enabled);
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

  const testWatchAlert = async () => {
    const result = await sendAlertToWatch({ level: 'alert', perclos: 0, at: Date.now() });
    const status = await getWatchStatus();
    setWatchStatus(status);
    if (!result.accepted) {
      Alert.alert('Watch unavailable', 'Open Occulert on your Apple Watch, then try again.');
    } else if (result.reachable) {
      Alert.alert('Watch test sent', 'Check your Apple Watch for the alert and wrist tap.');
    } else {
      Alert.alert('Watch test queued', 'Open Occulert on your Apple Watch and enable background alerts. Queued delivery may be delayed.');
    }
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
            <Switch value={haptic} onValueChange={v=>tog('occulert-haptic',v,setHaptic)} trackColor={{true:'#2563eb',false:'#1a3a4a'}} thumbColor="#fff" />
          </View>
          <View style={s.div}/>
          <View style={s.row}>
            <View style={s.rowL}><Ionicons name="volume-high-outline" size={18} color="#60a5fa" /><View><Text style={s.label}>Audio tone</Text><Text style={s.sub}>Sound on alert</Text></View></View>
            <Switch value={audio} onValueChange={v=>tog('occulert-audio',v,setAudio)} trackColor={{true:'#2563eb',false:'#1a3a4a'}} thumbColor="#fff" />
          </View>
        </View>
        <View style={s.card}>
          <Text style={s.cardTitle}>CONNECTED DEVICES</Text>
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="headset-outline" size={18} color="#60a5fa" />
              <View>
                <Text style={s.label}>AirPods / Bluetooth audio</Text>
                <Text style={s.sub}>Uses the iPhone's current audio output automatically</Text>
              </View>
            </View>
            <Text style={s.status}>AUTOMATIC</Text>
          </View>
          <View style={s.div} />
          <View style={s.patternBlock}>
            <View style={s.rowL}>
              <Ionicons name="ear-outline" size={18} color="#60a5fa" />
              <View>
                <Text style={s.label}>In-ear alert pattern</Text>
                <Text style={s.sub}>Optional stereo emphasis for early and standard alerts</Text>
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
            accessibilityRole="button"
            disabled={!watchAvailable || !watch}
            style={[s.testRow, (!watchAvailable || !watch) && s.testRowDisabled]}
            onPress={testWatchAlert}
          >
            <Ionicons name="pulse-outline" size={17} color="#60a5fa" />
            <Text style={s.testText}>Test Watch alert</Text>
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
  card:{backgroundColor:'rgba(14,26,43,0.94)',borderWidth:1,borderColor:'rgba(255,255,255,0.09)',borderRadius:radii.large,marginBottom:16,overflow:'hidden'},
  cardTitle:{color:colors.textSecondary,fontSize:11,fontWeight:'800',letterSpacing:0.8,textTransform:'uppercase',padding:14,borderBottomWidth:1,borderColor:'rgba(255,255,255,0.08)'},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,gap:12},
  rowL:{flexDirection:'row',alignItems:'center',gap:12,flex:1},
  label:{color:colors.text,fontSize:14,fontWeight:'700'}, sub:{color:colors.textMuted,fontSize:11,marginTop:2},
  status:{color:colors.cyan,fontSize:10,fontWeight:'900',letterSpacing:0.6},
  div:{height:1,backgroundColor:'rgba(255,255,255,0.08)',marginHorizontal:16},
  testRow:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingVertical:13},
  testRowDisabled:{opacity:0.35},
  testText:{color:'#60a5fa',fontSize:13,fontWeight:'800'},
  patternBlock:{paddingHorizontal:16,paddingVertical:14,gap:12},
  patternOptions:{flexDirection:'row',gap:8},
  patternOption:{flex:1,alignItems:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.12)',borderRadius:radii.small,paddingVertical:10,backgroundColor:'rgba(5,9,19,0.72)'},
  patternOptionSelected:{borderColor:'#60a5fa',backgroundColor:'rgba(37,99,235,0.2)'},
  patternOptionText:{color:'#7f9ba8',fontSize:12,fontWeight:'800'},
  patternOptionTextSelected:{color:'#bfdbfe'},
  patternNote:{color:colors.textMuted,fontSize:11,lineHeight:16},
  privNote:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:14,backgroundColor:'rgba(0,0,0,0.2)',borderTopWidth:1,borderColor:'rgba(255,255,255,0.08)'},
  privTxt:{color:colors.textMuted,fontSize:11,lineHeight:16,flex:1},
  ver:{textAlign:'center',color:colors.textMuted,fontSize:11,marginTop:8},
});
