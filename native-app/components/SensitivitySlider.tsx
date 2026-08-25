import React from 'react';
import { Alert, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SENSITIVITY_PRESETS, type SensitivityLevel } from '../constants/thresholds';
import { createSettingPersister } from '../lib/settingPersistence';
import { colors, radii } from '../constants/theme';

const SENSITIVITY_PREFERENCE_KEY = 'occulert-sensitivity';
const LEVELS: SensitivityLevel[] = ['low', 'medium', 'high'];
const sensitivitySettingPersister = createSettingPersister(AsyncStorage);

const parseSensitivityLevel = (value: string): SensitivityLevel => {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
};

interface Props { value: SensitivityLevel; onChange: (l: SensitivityLevel) => void; }

export function SensitivitySlider({ value, onChange }: Props) {
  const press = (level: SensitivityLevel) => {
    void sensitivitySettingPersister.save({
      key: SENSITIVITY_PREFERENCE_KEY,
      nextValue: level,
      previousValue: value,
      serialize: String,
      parse: parseSensitivityLevel,
      apply: onChange,
      onError: () => {
        Alert.alert(
          'Could not save sensitivity',
          'Your previous sensitivity setting is still active. Please try again.',
        );
      },
    });
  };
  return (
    <View style={s.wrap}>
      <Text style={s.label}>Alert sensitivity</Text>
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
      <Text style={s.thresh}>Changes when warnings begin. It does not make driving while tired safe.</Text>
    </View>
  );
}

export async function loadSavedSensitivity(): Promise<SensitivityLevel> {
  try {
    const value = await AsyncStorage.getItem(SENSITIVITY_PREFERENCE_KEY);
    if (value !== null) return parseSensitivityLevel(value);
  } catch {}
  return 'medium';
}

const s = StyleSheet.create({
  wrap:     { backgroundColor:colors.material, borderWidth:1, borderColor:colors.glassBorder, borderRadius:radii.large, padding:16, marginBottom:16 },
  label:    { color:colors.text, fontSize:15, fontWeight:'800', marginBottom:4 },
  desc:     { color:colors.textSecondary, fontSize:12, lineHeight:17, marginBottom:12 },
  row:      { flexDirection:'row', gap:8 },
  btn:      { flex:1, paddingVertical:10, borderRadius:radii.small, borderWidth:1, borderColor:colors.glassBorder, backgroundColor:colors.backgroundRaised, alignItems:'center' },
  active:   { borderColor:colors.blue, backgroundColor:'rgba(94,156,255,0.16)' },
  btnTxt:   { color:colors.textSecondary, fontSize:13, fontWeight:'800' },
  activeTxt:{ color:'#cfe0ff' },
  thresh:   { color:colors.textMuted, fontSize:11, lineHeight:16, marginTop:10 },
});
