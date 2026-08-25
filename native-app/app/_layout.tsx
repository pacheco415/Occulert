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
    </SafeAreaProvider>
  );
}
