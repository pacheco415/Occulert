import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SENSITIVITY_PRESETS, type SensitivityLevel } from '../constants/thresholds';

const KEY = 'occulert-sensitivity';
const LEVELS: SensitivityLevel[] = ['low', 'medium', 'high'];

interface Props { value: SensitivityLevel; onChange: (l: SensitivityLevel) => void; }

export function SensitivitySlider({ value, onChange }: Props) {
  const press = async (l: SensitivityLevel) => {
    onChange(l);
    try { await AsyncStorage.setItem(KEY, l); } catch {}
  };
  return (
    <View style={s.wrap}>
      <Text style={s.label}>🎚 Alert Sensitivity</Text>
      <Text style={s.desc}>{SENSITIVITY_PRESETS[value].description}</Text>
      <View style={s.row}>
        {LEVELS.map(l => (
          <TouchableOpacity key={l} style={[s.btn, value===l && s.active]} onPress={() => press(l)}
            accessibilityRole="button" accessibilityState={{ selected: value===l }}>
            <Text style={[s.btnTxt, value===l && s.activeTxt]}>
              {SENSITIVITY_PRESETS[l].label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.thresh}>
        closed: {SENSITIVITY_PRESETS[value].eyeClosedThreshold.toFixed(2)}  |  watch: {SENSITIVITY_PRESETS[value].eyeWatchThreshold.toFixed(2)}
      </Text>
    </View>
  );
}

export async function loadSavedSensitivity(): Promise<SensitivityLevel> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {}
  return 'medium';
}

const s = StyleSheet.create({
  wrap:     { backgroundColor:'rgba(37,99,235,0.06)', borderWidth:1, borderColor:'rgba(37,99,235,0.2)', borderRadius:14, padding:16, marginBottom:16 },
  label:    { color:'#c8e8f0', fontSize:14, fontWeight:'800', marginBottom:4 },
  desc:     { color:'#94a3b8', fontSize:12, lineHeight:17, marginBottom:12 },
  row:      { flexDirection:'row', gap:8 },
  btn:      { flex:1, paddingVertical:10, borderRadius:10, borderWidth:1.5, borderColor:'#1a3a4a', backgroundColor:'#0f1e2e', alignItems:'center' },
  active:   { borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,0.15)' },
  btnTxt:   { color:'#94a3b8', fontSize:13, fontWeight:'800' },
  activeTxt:{ color:'#60a5fa' },
  thresh:   { color:'#4a7a8a', fontSize:11, marginTop:10 },
});
