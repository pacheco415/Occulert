import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getCloudState,
  setCloudSyncEnabled,
  signInToCloud,
  signOutOfCloud,
  type CloudState,
} from '../lib/cloudSync';
import { createSingleFlightActionRunner } from '../lib/singleFlightAction';
import { colors, radii } from '../constants/theme';

const EMPTY_STATE: CloudState = {
  available: true,
  signedIn: false,
  email: null,
  syncEnabled: false,
};

export function CloudSyncCard() {
  const [state, setState] = useState<CloudState>(EMPTY_STATE);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const mountedRef = useRef(true);
  const actionRunnerRef = useRef(createSingleFlightActionRunner());

  const refresh = useCallback(async () => {
    const nextState = await getCloudState();
    if (!mountedRef.current) return;
    setState(nextState);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh()
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setBusy(false);
      });
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const runBusyAction = useCallback((action: () => Promise<void>) => {
    void actionRunnerRef.current.run({
      action,
      onBusyChange: nextBusy => {
        if (mountedRef.current) setBusy(nextBusy);
      },
      onError: () => {
        if (!mountedRef.current) return;
        Alert.alert(
          'Cloud sync unavailable',
          'Occulert could not complete or confirm that change. Please check your connection and try again.',
        );
      },
    });
  }, []);

  const signIn = () => {
    runBusyAction(async () => {
      const result = await signInToCloud(email, password);
      if (!mountedRef.current) return;
      setPassword('');
      await refresh();
      if (mountedRef.current) {
        Alert.alert(result.ok ? 'Signed in' : 'Sign-in unavailable', result.message);
      }
    });
  };

  const signOut = () => {
    runBusyAction(async () => {
      await signOutOfCloud();
      if (!mountedRef.current) return;
      setEmail('');
      setPassword('');
      await refresh();
    });
  };

  const applyConsent = (enabled: boolean) => {
    runBusyAction(async () => {
      const saved = await setCloudSyncEnabled(enabled);
      if (!mountedRef.current) return;
      await refresh();
      if (!saved) {
        Alert.alert('Cloud sync unavailable', 'Sign in again or check your connection, then try once more.');
      }
    });
  };

  const changeConsent = (enabled: boolean) => {
    if (!enabled) {
      applyConsent(false);
      return;
    }
    Alert.alert(
      'Share session summaries?',
      'Occulert will send timestamps, fatigue scores, and alert counts to your protected account. Camera images, video, audio, location, and alert ratings stay off the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Enable', onPress: () => { applyConsent(true); } },
      ],
    );
  };

  const openAccountPage = async () => {
    const url = 'https://www.occulert.com/login.html';
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Use the same bounded recovery message as an unsupported link.
    }
    if (mountedRef.current) {
      Alert.alert('Account page unavailable', 'Open occulert.com/login.html in Safari.');
    }
  };

  return (
    <View style={s.card}>
      <View style={s.titleRow}>
        <Text style={s.cardTitle}>CLOUD SESSION SYNC</Text>
        {busy
          ? <ActivityIndicator size="small" color="#60a5fa" />
          : <Text style={[s.status, state.signedIn && s.statusOn]}>
              {state.signedIn ? 'SIGNED IN' : state.available ? 'OPTIONAL' : 'UNAVAILABLE'}
            </Text>}
      </View>

      {!state.signedIn ? (
        <View style={s.form}>
          <Text style={s.formIntro}>
            Sign in with an existing Occulert driver account. Monitoring and local history work without an account.
          </Text>
          <TextInput
            accessibilityLabel="Cloud account email"
            autoCapitalize="none"
            autoComplete="email"
            editable={!busy && state.available}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Driver email"
            placeholderTextColor="#4a7a8a"
            style={s.input}
            value={email}
          />
          <TextInput
            accessibilityLabel="Cloud account password"
            autoCapitalize="none"
            autoComplete="current-password"
            editable={!busy && state.available}
            onChangeText={setPassword}
            onSubmitEditing={signIn}
            placeholder="Password"
            placeholderTextColor="#4a7a8a"
            secureTextEntry
            style={s.input}
            value={password}
          />
          <TouchableOpacity
            accessibilityRole="button"
            disabled={busy || !state.available}
            onPress={signIn}
            style={[s.primaryBtn, (busy || !state.available) && s.disabled]}
          >
            <Ionicons name="log-in-outline" size={17} color="#fff" />
            <Text style={s.primaryText}>SIGN IN</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="link" onPress={openAccountPage} style={s.linkBtn}>
            <Text style={s.linkText}>Create or manage an account on occulert.com</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={s.accountRow}>
            <View style={s.accountText}>
              <Text style={s.label}>Protected account</Text>
              <Text numberOfLines={1} style={s.sub}>{state.email}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={signOut} style={s.signOutBtn}>
              <Text style={s.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
          <View style={s.div} />
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="cloud-upload-outline" size={18} color="#60a5fa" />
              <View style={s.accountText}>
                <Text style={s.label}>Share session summaries</Text>
                <Text style={s.sub}>Off by default · local history remains available</Text>
              </View>
            </View>
            <Switch
              accessibilityLabel="Share session summaries"
              disabled={busy}
              onValueChange={changeConsent}
              thumbColor="#fff"
              trackColor={{ true: '#2563eb', false: '#1a3a4a' }}
              value={state.syncEnabled}
            />
          </View>
        </>
      )}

      <View style={s.privacy}>
        <Ionicons name="shield-checkmark-outline" size={14} color="#4a7a8a" />
        <Text style={s.privacyText}>
          Sign-in tokens use protected device storage. No camera images, video, audio, GPS location, or alert ratings are uploaded.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.material, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.large, marginBottom: 16, overflow: 'hidden' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderColor: colors.glassBorder },
  cardTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  status: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  statusOn: { color: colors.green },
  form: { padding: 14, gap: 10 },
  formIntro: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 2 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.small, backgroundColor: colors.backgroundRaised, color: colors.text, paddingHorizontal: 12, fontSize: 14 },
  primaryBtn: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.blueStrong, borderRadius: radii.small },
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  disabled: { opacity: 0.4 },
  linkBtn: { alignItems: 'center', paddingVertical: 6 },
  linkText: { color: colors.blue, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  accountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  accountText: { flex: 1 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  sub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  signOutBtn: { borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.small, paddingHorizontal: 12, paddingVertical: 8 },
  signOutText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  div: { height: 1, backgroundColor: colors.glassBorder, marginHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowL: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 14, backgroundColor: colors.backgroundRaised, borderTopWidth: 1, borderColor: colors.glassBorder },
  privacyText: { color: colors.textMuted, fontSize: 11, lineHeight: 16, flex: 1 },
});
