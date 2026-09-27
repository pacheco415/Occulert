import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  Linking,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import {
  getCloudState,
  setCloudSyncEnabled,
  signInToCloud,
  signOutOfCloud,
  type CloudState,
} from '../lib/cloudSync';
import { createSingleFlightActionRunner } from '../lib/singleFlightAction';
import { colors, radii } from '../constants/theme';

const ACCOUNT_LINKS = {
  create: 'https://www.occulert.com/login.html',
  reset: 'https://www.occulert.com/login.html?mode=reset',
  manage: 'https://www.occulert.com/account.html',
} as const;

export function CloudSyncCard() {
  const [state, setState] = useState<CloudState | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const mountedRef = useRef(true);
  const focusedRef = useRef(false);
  const appActiveRef = useRef(AppState.currentState === 'active');
  const stateRef = useRef<CloudState | null>(null);
  const statusReadRef = useRef(0);
  const statusBusyRef = useRef(false);
  const actionBusyRef = useRef(false);
  const passwordInputRef = useRef<TextInput | null>(null);
  const actionRunnerRef = useRef(createSingleFlightActionRunner());
  const busy = actionBusy || statusBusy;
  const visible = useCallback(() => mountedRef.current && focusedRef.current && appActiveRef.current, []);

  const refresh = useCallback(async () => {
    if (!visible()) return false;
    const revision = ++statusReadRef.current;
    statusBusyRef.current = true;
    stateRef.current = null;
    setState(null);
    setStatusBusy(true);
    setStatusError(false);
    const nextState = await getCloudState();
    if (!visible() || revision !== statusReadRef.current) return false;
    statusBusyRef.current = false;
    setStatusBusy(false);
    if (nextState.readStatus !== 'confirmed') {
      setStatusError(true);
      return false;
    }
    stateRef.current = nextState;
    setState(nextState);
    return true;
  }, [visible]);

  const invalidateStatus = useCallback(() => {
    statusReadRef.current += 1;
    statusBusyRef.current = false;
    stateRef.current = null;
    if (!mountedRef.current) return;
    setState(null);
    setStatusBusy(false);
    setStatusError(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', next => {
      appActiveRef.current = next === 'active';
      if (!appActiveRef.current) {
        invalidateStatus();
      } else if (focusedRef.current && !actionBusyRef.current) {
        void refresh();
      }
    });
    return () => {
      mountedRef.current = false;
      statusReadRef.current += 1;
      stateRef.current = null;
      subscription.remove();
    };
  }, [invalidateStatus, refresh]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    if (!actionBusyRef.current) void refresh();
    return () => {
      focusedRef.current = false;
      invalidateStatus();
      setPassword('');
    };
  }, [invalidateStatus, refresh]));

  const runBusyAction = useCallback((action: () => Promise<void>) => {
    if (!visible() || statusBusyRef.current || actionBusyRef.current || stateRef.current?.readStatus !== 'confirmed') return;
    statusReadRef.current += 1;
    Keyboard.dismiss();
    void actionRunnerRef.current.run({
      action,
      onBusyChange: nextBusy => {
        actionBusyRef.current = nextBusy;
        if (mountedRef.current) setActionBusy(nextBusy);
        if (!nextBusy && visible() && !stateRef.current && !statusBusyRef.current) void refresh();
      },
      onError: () => {
        if (!visible()) return;
        invalidateStatus();
        setStatusError(true);
        Alert.alert(
          'Cloud sync unavailable',
          'Occulert could not complete or confirm that change. Please check your connection and try again.',
        );
      },
    });
  }, [invalidateStatus, refresh, visible]);

  const signIn = () => {
    runBusyAction(async () => {
      const result = await signInToCloud(email, password);
      if (!mountedRef.current) return;
      setPassword('');
      const confirmed = await refresh();
      if (confirmed && visible()) {
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
      if (!saved && visible()) {
        Alert.alert('Cloud sync unavailable', 'Sign in again or check your connection, then try once more.');
      }
    });
  };

  const changeConsent = (enabled: boolean) => {
    const confirmedState = stateRef.current;
    if (!confirmedState?.signedIn || busy || !visible()) return;
    if (!enabled) {
      applyConsent(false);
      return;
    }
    Alert.alert(
      'Share session summaries?',
      'Occulert will send timestamps, fatigue scores, and alert counts to your protected account. Camera images, video, audio, location, and alert ratings stay off the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Enable', onPress: () => {
          if (visible() && stateRef.current === confirmedState && !actionBusyRef.current && !statusBusyRef.current) applyConsent(true);
        } },
      ],
    );
  };

  const openAccountPage = async (page: keyof typeof ACCOUNT_LINKS) => {
    if (!visible()) return;
    const url = ACCOUNT_LINKS[page];
    try {
      if (await Linking.canOpenURL(url)) {
        if (!visible()) return;
        Keyboard.dismiss();
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Use the same bounded recovery message as an unsupported link.
    }
    if (visible()) {
      Alert.alert('Account page unavailable', 'Open ' + url.replace('https://www.', '') + ' in your browser. Browser sign-in is separate from this iPhone.');
    }
  };

  return (
    <View style={s.card}>
      <View style={s.titleRow}>
        <Text style={s.cardTitle}>CLOUD SESSION SYNC</Text>
        {busy
          ? <ActivityIndicator accessibilityLabel="Checking cloud sync status" size="small" color="#60a5fa" />
          : <Text accessibilityLiveRegion="polite" accessibilityRole="text" style={[s.status, state?.signedIn && s.statusOn]}>
              {state?.signedIn ? 'SIGNED IN' : state ? 'OPTIONAL' : 'UNCONFIRMED'}
            </Text>}
      </View>

      {!state && (
        <View accessibilityRole={statusError ? 'alert' : 'text'} accessibilityLiveRegion="polite" style={s.statusCheck}>
          <Text style={s.label}>{statusError ? 'Account status could not be confirmed' : 'Checking saved cloud settings…'}</Text>
          <Text style={s.statusDetail}>
            {statusError
              ? 'This status check does not clear saved sign-in or change sharing. Retry to read the current choices before making changes. Monitoring and local history remain available.'
              : 'Reading the sign-in and sharing choice saved on this iPhone. Monitoring and local history do not require cloud sync.'}
          </Text>
          {statusError && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry saved cloud account status"
              accessibilityHint="Reads local sign-in and sharing settings without changing them"
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={() => { if (!statusBusyRef.current && !actionBusyRef.current) void refresh(); }}
              style={[s.retryBtn, busy && s.disabled]}
            >
              <Ionicons name="refresh" size={16} color="#93c5fd" />
              <Text style={s.linkText}>Retry account status</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {state && !state.signedIn && (
        <View style={s.form}>
          <Text style={s.formIntro}>
            Sign in with an existing Occulert driver account and its password. Monitoring and local history work without an account.
          </Text>
          <TextInput
            accessibilityLabel="Cloud account email"
            accessibilityHint="Enter the email for your existing Occulert driver account"
            accessibilityState={{ disabled: busy || !state.available }}
            autoCapitalize="none"
            autoComplete="email"
            editable={!busy && state.available}
            keyboardType="email-address"
            onChangeText={setEmail}
            onSubmitEditing={() => passwordInputRef.current?.focus()}
            placeholder="Driver email"
            placeholderTextColor="#4a7a8a"
            returnKeyType="next"
            submitBehavior="submit"
            style={s.input}
            value={email}
          />
          <TextInput
            accessibilityLabel="Cloud account password"
            accessibilityHint="Enter your Occulert account password"
            accessibilityState={{ disabled: busy || !state.available }}
            autoCapitalize="none"
            autoComplete="current-password"
            editable={!busy && state.available}
            onChangeText={setPassword}
            onSubmitEditing={signIn}
            placeholder="Password"
            placeholderTextColor="#4a7a8a"
            ref={passwordInputRef}
            returnKeyType="done"
            secureTextEntry
            style={s.input}
            value={password}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={busy ? 'Signing in to cloud account' : 'Sign in to cloud account'}
            accessibilityHint="Signs in without enabling session sharing"
            accessibilityState={{ disabled: busy || !state.available, busy }}
            disabled={busy || !state.available}
            onPress={signIn}
            style={[s.primaryBtn, (busy || !state.available) && s.disabled]}
          >
            <Ionicons name="log-in-outline" size={17} color="#fff" />
            <Text style={s.primaryText}>SIGN IN</Text>
          </TouchableOpacity>
        </View>
      )}
      {state?.signedIn && (
        <>
          <View style={s.accountRow}>
            <View style={s.accountText}>
              <Text style={s.label}>Protected account</Text>
              <Text style={s.sub}>{state.email}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={busy ? 'Signing out of cloud account' : 'Sign out of cloud account'}
              accessibilityHint="Signs out on this device without deleting local history"
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={signOut}
              style={[s.signOutBtn, busy && s.disabled]}
            >
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
              accessibilityHint="Controls protected cloud syncing; local history remains available when off"
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onValueChange={changeConsent}
              thumbColor="#fff"
              trackColor={{ true: '#2563eb', false: '#1a3a4a' }}
              value={state.syncEnabled}
            />
          </View>
        </>
      )}

      <View style={s.accountLinks}>
        {!state?.signedIn && (
          <>
            <TouchableOpacity
              accessibilityRole="link"
              accessibilityLabel="Forgot Occulert account password"
              accessibilityHint="Opens password reset in your browser without sending your email or password in the link"
              onPress={() => { void openAccountPage('reset'); }}
              style={s.linkBtn}
            >
              <Text style={s.linkText}>Forgot password?</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="link"
              accessibilityLabel="Create an Occulert account on the website"
              accessibilityHint="Opens browser sign-in and account creation"
              onPress={() => { void openAccountPage('create'); }}
              style={s.linkBtn}
            >
              <Text style={s.linkText}>Create an account on occulert.com</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          accessibilityRole="link"
          accessibilityLabel="Manage Occulert cloud account"
          accessibilityHint="Opens website account settings for password, email, and account deletion; browser sign-in is separate"
          onPress={() => { void openAccountPage('manage'); }}
          style={s.linkBtn}
        >
          <Text style={s.linkText}>Manage account on occulert.com</Text>
        </TouchableOpacity>
        <Text style={s.statusDetail}>
          Browser sign-in is separate from this iPhone. If you created your account with a passkey or email link, sign in on the website, open Account, and choose Change Password to set a password for native sign-in. Sharing stays off after a new native sign-in until you enable it here.
        </Text>
      </View>

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
  titleRow: { minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 14, borderBottomWidth: 1, borderColor: colors.glassBorder },
  cardTitle: { flexShrink: 1, color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  status: { flexShrink: 1, color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  statusOn: { color: colors.green },
  statusCheck: { padding: 14, gap: 8 },
  statusDetail: { color: colors.textSecondary, fontSize: 11, lineHeight: 17 },
  retryBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.small },
  accountLinks: { paddingHorizontal: 14, paddingBottom: 14, gap: 4 },
  form: { padding: 14, gap: 10 },
  formIntro: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 2 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.small, backgroundColor: colors.backgroundRaised, color: colors.text, paddingHorizontal: 12, fontSize: 14 },
  primaryBtn: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.blueStrong, borderRadius: radii.small },
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  disabled: { opacity: 0.4 },
  linkBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 8 },
  linkText: { color: colors.blue, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  accountRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  accountText: { minWidth: 0, flexGrow: 1, flexBasis: 180 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  sub: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  signOutBtn: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radii.small, paddingHorizontal: 12, paddingVertical: 8 },
  signOutText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  div: { height: 1, backgroundColor: colors.glassBorder, marginHorizontal: 16 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowL: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 14, backgroundColor: colors.backgroundRaised, borderTopWidth: 1, borderColor: colors.glassBorder },
  privacyText: { color: colors.textMuted, fontSize: 11, lineHeight: 16, flex: 1 },
});
