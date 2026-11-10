import { StyleSheet, Text, View } from 'react-native';

export function SimulatorTraceBanner() {
  return <View style={styles.banner}>
    <Text accessibilityRole="header" style={styles.title}>SIMULATOR TRACE</Text>
    <Text style={styles.detail}>Synthetic input · Cloud disabled · Not for driving</Text>
  </View>;
}
const styles = StyleSheet.create({
  banner: { backgroundColor: '#fbbf24', paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  title: { color: '#111827', fontSize: 18, fontWeight: '900' },
  detail: { color: '#111827', fontSize: 12, fontWeight: '600' },
});
