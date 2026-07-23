import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Switch, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { SensitivitySlider, loadSavedSensitivity } from '../components/SensitivitySlider';
import type { SensitivityLevel } from '../constants/thresholds';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { openFeedback } from '../lib/feedback';
import { getWatchStatus, sendAlertToWatch, type WatchStatus } from '../lib/watchBridge';

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
  const [watch, setWatch] = useState(false);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>(EMPTY_WATCH_STATUS);
  const watchAvailable = watchStatus.paired && watchStatus.appInstalled;

  useEffect(() => {
    loadSavedSensitivity().then(setSens);
    AsyncStorage.getItem('occulert-haptic').then(v => { if(v) setHaptic(v==='true'); });
    AsyncStorage.getItem('occulert-audio').then(v => { if(v) setAudio(v==='true'); });
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([
      getWatchStatus(),
      AsyncStorage.getItem('occulert-watch'),
    ]).then(([status, saved]) => {
      if (!active) return;
      setWatchStatus(status);
      setWatch(saved === 'true');
    }).catch(() => {});
    return () => { active = false; };
  }, []));

  const tog = async (key: string, val: boolean, set: (v: boolean) => void) => {
    set(val); await AsyncStorage.setItem(key, String(val));
  };

  const watchDescription = !watchStatus.moduleAvailable
    ? 'Watch support is unavailable in this build'
    : !watchStatus.paired
      ? 'No Apple Watch is paired'
      : !watchStatus.appInstalled
        ? 'Install the Occulert Watch app to enable wrist alerts'
        : watchStatus.reachable
          ? 'Connected — live wrist alerts are ready'
          : 'Companion installed — open it for live wrist alerts';

  const testWatchAlert = async () => {
    const result = await sendAlertToWatch({ level: 'alert', perclos: 0, at: Date.now() });
    const status = await getWatchStatus();
    setWatchStatus(status);
    if (!result.accepted) {
      Alert.alert('Watch unavailable', 'Open Occulert on your Apple Watch, then try again.');
    } else if (result.reachable) {
      Alert.alert('Watch test sent', 'Your Apple Watch should alert and vibrate now.');
    } else {
      Alert.alert('Watch test queued', 'Open Occulert on your Apple Watch to receive the test alert.');
    }
  };

  return (
    <SafeAreaView style={s.bg}>
      <ScrollView contentContainerStyle={s.scroll}>
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
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="watch-outline" size={18} color="#60a5fa" />
              <View>
                <Text style={s.label}>Apple Watch alerts</Text>
                <Text style={s.sub}>{watchDescription}</Text>
              </View>
            </View>
            <Switch disabled={!watchAvailable} value={watch && watchAvailable} onValueChange={v => tog('occulert-watch', v, setWatch)} trackColor={{ true: '#2563eb', false: '#1a3a4a' }} thumbColor="#fff" />
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
        <Text style={s.ver}>Occulert™ · v1.0.0 · San Francisco, CA</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  bg:{flex:1,backgroundColor:'#050a0f'}, scroll:{padding:20,paddingBottom:48},
  title:{color:'#fff',fontSize:28,fontWeight:'900',marginBottom:20},
  card:{backgroundColor:'#0f1e2e',borderWidth:1,borderColor:'#1a3a4a',borderRadius:14,marginBottom:16,overflow:'hidden'},
  cardTitle:{color:'#94a3b8',fontSize:11,fontWeight:'800',letterSpacing:0.8,textTransform:'uppercase',padding:12,borderBottomWidth:1,borderColor:'#1a3a4a'},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,gap:12},
  rowL:{flexDirection:'row',alignItems:'center',gap:12,flex:1},
  label:{color:'#c8e8f0',fontSize:14,fontWeight:'700'}, sub:{color:'#4a7a8a',fontSize:11,marginTop:2},
  status:{color:'#60a5fa',fontSize:10,fontWeight:'900',letterSpacing:0.6},
  div:{height:1,backgroundColor:'#1a3a4a',marginHorizontal:16},
  testRow:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingVertical:13},
  testRowDisabled:{opacity:0.35},
  testText:{color:'#60a5fa',fontSize:13,fontWeight:'800'},
  privNote:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:14,backgroundColor:'rgba(0,0,0,0.2)',borderTopWidth:1,borderColor:'#1a3a4a'},
  privTxt:{color:'#4a7a8a',fontSize:11,lineHeight:16,flex:1},
  ver:{textAlign:'center',color:'#4a7a8a',fontSize:11,marginTop:8},
});
