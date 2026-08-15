import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.backgroundRaised },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '800' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Occulert', headerShown: false }} />
        <Stack.Screen
          name="pre-drive"
          options={{ title: 'Pre-Drive Safety Check', headerBackTitle: 'Home' }}
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
        <Stack.Screen name="settings" options={{ title: 'Settings', headerBackTitle: 'Back' }} />
        <Stack.Screen name="history" options={{ title: 'Session History', headerBackTitle: 'Back' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
