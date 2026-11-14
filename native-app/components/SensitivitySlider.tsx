import { strings, formatString } from '../lib/strings.ts';
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
          strings.settings.sensitivity.errorTitle,
          strings.settings.sensitivity.errorDetail,
        );
      },
    });
  };
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{strings.settings.sensitivity.title}</Text>
      <Text style={s.desc}>{SENSITIVITY_PRESETS[value].description}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={strings.settings.sensitivity.title}
        accessibilityHint={strings.settings.sensitivity.hint}
        style={s.row}
      >
        {LEVELS.map(l => (
          <TouchableOpacity
            key={l}
            style={[s.btn, value===l && s.active]}
            onPress={() => press(l)}
            accessibilityRole="radio"
            accessibilityLabel={formatString(strings.settings.sensitivity.optionAccessibility, { level: SENSITIVITY_PRESETS[l].label })}
            accessibilityHint={SENSITIVITY_PRESETS[l].description}
            accessibilityState={{ selected: value===l }}
          >
            <Text style={[s.btnTxt, value===l && s.activeTxt]}>
              {SENSITIVITY_PRESETS[l].label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.thresh}>{strings.settings.sensitivity.limits}</Text>
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
  row:      { flexDirection:'row', flexWrap:'wrap', gap:8 },
  btn:      { flexGrow:1, flexBasis:90, minHeight:48, paddingHorizontal:8, paddingVertical:10, borderRadius:radii.small, borderWidth:1, borderColor:colors.glassBorder, backgroundColor:colors.backgroundRaised, alignItems:'center', justifyContent:'center' },
  active:   { borderColor:colors.blue, backgroundColor:'rgba(94,156,255,0.16)' },
  btnTxt:   { color:colors.textSecondary, fontSize:13, fontWeight:'800', textAlign:'center' },
  activeTxt:{ color:'#cfe0ff' },
  thresh:   { color:colors.textMuted, fontSize:11, lineHeight:16, marginTop:10 },
});
