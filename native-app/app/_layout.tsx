import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#050a0f' },
          headerTintColor: '#c8e8f0',
          headerTitleStyle: { fontWeight: '900' },
          contentStyle: { backgroundColor: '#050a0f' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Occulert', headerShown: false }} />
        <Stack.Screen
          name="monitor"
          options={{ title: 'Monitoring', headerBackTitle: 'Home', headerShown: false }}
        />
        <Stack.Screen name="settings" options={{ title: 'Settings', headerBackTitle: 'Back' }} />
        <Stack.Screen name="history" options={{ title: 'Session History', headerBackTitle: 'Back' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
