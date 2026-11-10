import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { retryPendingCloudSessions } from '../lib/cloudSync';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { SIMULATOR_TRACE } from '../lib/simulatorTrace';
import { SimulatorTraceBanner } from '../components/SimulatorTraceBanner';

export default function RootLayout() {
  useEffect(() => {
    void retryPendingCloudSessions();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void retryPendingCloudSessions();
    });
    return () => listener.remove();
  }, []);
  const navigation = (
    <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Occulert', headerShown: false }} />
        <Stack.Screen
          name="pre-drive"
          options={{ title: '', headerBackTitle: 'Home' }}
        />
        <Stack.Screen
          name="monitor"
          options={{
            title: 'Monitoring',
            headerBackTitle: 'Safety Check',
            headerShown: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="settings" options={{ title: '', headerBackTitle: 'Home' }} />
        <Stack.Screen name="history" options={{ title: '', headerBackTitle: 'Home' }} />
    </Stack>
  );
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {SIMULATOR_TRACE ? <View style={{ flex: 1 }}><SimulatorTraceBanner />{navigation}</View> : navigation}
    </SafeAreaProvider>
  );
}
