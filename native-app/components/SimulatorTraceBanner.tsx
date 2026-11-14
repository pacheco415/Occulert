import { StyleSheet, Text, View } from 'react-native';
import { strings } from '../lib/strings';

export function SimulatorTraceBanner() {
  return <View style={styles.banner}>
    <Text accessibilityRole="header" style={styles.title}>{strings.simulator.title}</Text>
    <Text style={styles.detail}>{strings.simulator.detail}</Text>
  </View>;
}
const styles = StyleSheet.create({
  banner: { backgroundColor: '#fbbf24', paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  title: { color: '#111827', fontSize: 18, fontWeight: '900' },
  detail: { color: '#111827', fontSize: 12, fontWeight: '600' },
});
