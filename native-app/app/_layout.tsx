import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { retryPendingCloudSessions } from '../lib/cloudSync';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { SIMULATOR_TRACE } from '../lib/simulatorTrace';
import { SimulatorTraceBanner } from '../components/SimulatorTraceBanner';
import { strings } from '../lib/strings';

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
        <Stack.Screen name="index" options={{ title: strings.navigation.app, headerShown: false }} />
        <Stack.Screen
          name="pre-drive"
          options={{ title: '', headerBackTitle: strings.navigation.home }}
        />
        <Stack.Screen
          name="monitor"
          options={{
            title: strings.navigation.monitoring,
            headerBackTitle: strings.navigation.safetyCheck,
            headerShown: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="settings" options={{ title: '', headerBackTitle: strings.navigation.home }} />
        <Stack.Screen name="history" options={{ title: '', headerBackTitle: strings.navigation.home }} />
    </Stack>
  );
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {SIMULATOR_TRACE ? <View style={{ flex: 1 }}><SimulatorTraceBanner />{navigation}</View> : navigation}
    </SafeAreaProvider>
  );
}
