import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SensitivitySlider, loadSavedSensitivity } from '../components/SensitivitySlider';
import type { SensitivityLevel } from '../constants/thresholds';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SettingsScreen() {
  const [sens, setSens] = useState<SensitivityLevel>('medium');
  const [haptic, setHaptic] = useState(true);
  const [audio, setAudio] = useState(true);
  const [airpods, setAirpods] = useState(true);
  const [watch, setWatch] = useState(true);

  useEffect(() => {
    loadSavedSensitivity().then(setSens);
    AsyncStorage.getItem('occulert-haptic').then(v => { if(v) setHaptic(v==='true'); });
    AsyncStorage.getItem('occulert-audio').then(v => { if(v) setAudio(v==='true'); });
    AsyncStorage.getItem('occulert-airpods').then(v => { if(v) setAirpods(v==='true'); });
    AsyncStorage.getItem('occulert-watch').then(v => { if(v) setWatch(v==='true'); });
  }, []);

  const tog = async (key: string, val: boolean, set: (v: boolean) => void) => {
    set(val); await AsyncStorage.setItem(key, String(val));
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
          <View style={s.card}>
            <Text style={s.cardTitle}>CONNECTED DEVICES</Text>
            <View style={s.row}>
              <View style={s.rowL}>
                <Ionicons name="headset-outline" size={18} color="#60a5fa" />
                <View>
                  <Text style={s.label}>AirPods / Bluetooth audio</Text>
                  <Text style={s.sub}>Play alerts through connected earbuds</Text>
                </View>
              </View>
              <Switch value={airpods} onValueChange={v => tog('occulert-airpods', v, setAirpods)} trackColor={{ true: '#2563eb', false: '#1a3a4a' }} thumbColor="#fff" />
            </View>
            <View style={s.div} />
            <View style={s.row}>
              <View style={s.rowL}>
                <Ionicons name="watch-outline" size={18} color="#60a5fa" />
                <View>
                  <Text style={s.label}>Apple Watch alerts</Text>
                  <Text style={s.sub}>Wrist haptics (requires the Watch app)</Text>
                </View>
              </View>
              <Switch value={watch} onValueChange={v => tog('occulert-watch', v, setWatch)} trackColor={{ true: '#2563eb', false: '#1a3a4a' }} thumbColor="#fff" />
            </View>
          </View>

          <View style={s.privNote}><Ionicons name="lock-closed-outline" size={13} color="#4a7a8a" /><Text style={s.privTxt}>No camera video stored or uploaded. Detection is fully on-device.</Text></View>
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
  div:{height:1,backgroundColor:'#1a3a4a',marginHorizontal:16},
  privNote:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:14,backgroundColor:'rgba(0,0,0,0.2)',borderTopWidth:1,borderColor:'#1a3a4a'},
  privTxt:{color:'#4a7a8a',fontSize:11,lineHeight:16,flex:1},
  ver:{textAlign:'center',color:'#4a7a8a',fontSize:11,marginTop:8},
});
