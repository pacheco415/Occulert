import { strings, formatString } from '../lib/strings.ts';
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
  type TextInputInstance,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import {
  getCloudState,
  nativeCloudEventRetryStatus,
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
  const [eventRetry, setEventRetry] = useState<ReturnType<typeof nativeCloudEventRetryStatus>>(null);
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
  const passwordInputRef = useRef<TextInputInstance | null>(null);
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
    setEventRetry(nativeCloudEventRetryStatus());
    return true;
  }, [visible]);

  const invalidateStatus = useCallback(() => {
    statusReadRef.current += 1;
    statusBusyRef.current = false;
    stateRef.current = null;
    if (!mountedRef.current) return;
    setState(null);
    setEventRetry(null);
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
          strings.settings.cloud.unavailableTitle,
          strings.settings.cloud.unavailableDetail,
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
        Alert.alert(result.ok ? strings.settings.cloud.signedInTitle : strings.settings.cloud.signInUnavailableTitle, result.message);
      }
    });
  };

  const signOut = () => {
    runBusyAction(async () => {
      let incomplete = false;
      try {
        await signOutOfCloud();
      } catch {
        incomplete = true;
      }
      if (!mountedRef.current) return;
      setEmail('');
      setPassword('');
      const confirmed = await refresh();
      if (incomplete && visible() && (!confirmed || stateRef.current?.signOutIncomplete)) {
        Alert.alert(strings.settings.cloud.signOutIncompleteTitle, strings.settings.cloud.signOutIncompleteDetail);
      }
    });
  };

  const applyConsent = (enabled: boolean) => {
    runBusyAction(async () => {
      const saved = await setCloudSyncEnabled(enabled);
      if (!mountedRef.current) return;
      await refresh();
      if (!saved && visible()) {
        Alert.alert(strings.settings.cloud.unavailableTitle, strings.settings.cloud.retrySignInDetail);
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
      strings.settings.cloud.consent.title,
      strings.settings.cloud.consent.detail,
      [
        { text: strings.settings.cloud.consent.cancel, style: 'cancel' },
        { text: strings.settings.cloud.consent.enable, onPress: () => {
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
      Alert.alert(strings.settings.cloud.accountPageUnavailableTitle, formatString(strings.settings.cloud.accountPageUnavailableDetail, { address: url.replace('https://www.', '') }));
    }
  };

  return (
    <View style={s.card}>
      <View style={s.titleRow}>
        <Text style={s.cardTitle}>{strings.settings.cloud.title}</Text>
        {busy
          ? <ActivityIndicator accessibilityLabel={strings.settings.cloud.checkingAccessibility} size="small" color="#60a5fa" />
          : <Text accessibilityLiveRegion="polite" accessibilityRole="text" style={[s.status, state?.signedIn && s.statusOn]}>
              {state?.signOutIncomplete ? strings.settings.cloud.status.signOutIncomplete : state?.signedIn ? strings.settings.cloud.status.signedIn : state ? strings.settings.cloud.status.optional : strings.settings.cloud.status.unconfirmed}
            </Text>}
      </View>

      {!state && (
        <View accessibilityRole={statusError ? 'alert' : 'text'} accessibilityLiveRegion="polite" style={s.statusCheck}>
          <Text style={s.label}>{statusError ? strings.settings.cloud.readState.errorTitle : strings.settings.cloud.readState.checkingTitle}</Text>
          <Text style={s.statusDetail}>
            {statusError
              ? strings.settings.cloud.readState.errorDetail
              : strings.settings.cloud.readState.checkingDetail}
          </Text>
          {statusError && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={strings.settings.cloud.readState.retryAccessibility}
              accessibilityHint={strings.settings.cloud.readState.retryHint}
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={() => { if (!statusBusyRef.current && !actionBusyRef.current) void refresh(); }}
              style={[s.retryBtn, busy && s.disabled]}
            >
              <Ionicons name="refresh" size={16} color="#93c5fd" />
              <Text style={s.linkText}>{strings.settings.cloud.readState.retryAction}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {state?.signOutIncomplete && (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.statusCheck}>
          <Text style={s.label}>{strings.settings.cloud.incomplete.title}</Text>
          <Text style={s.statusDetail}>{strings.settings.cloud.incomplete.detail}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={strings.settings.cloud.incomplete.retryAccessibility}
            accessibilityHint={strings.settings.cloud.incomplete.retryHint}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={signOut}
            style={[s.retryBtn, busy && s.disabled]}
          >
            <Text style={s.linkText}>{strings.settings.cloud.incomplete.retryAction}</Text>
          </TouchableOpacity>
        </View>
      )}

      {state && !state.signedIn && !state.signOutIncomplete && (
        <View style={s.form}>
          <Text style={s.formIntro}>{strings.settings.cloud.signIn.detail}</Text>
          <TextInput
            accessibilityLabel={strings.settings.cloud.signIn.emailAccessibility}
            accessibilityHint={strings.settings.cloud.signIn.emailHint}
            accessibilityState={{ disabled: busy || !state.available }}
            autoCapitalize="none"
            autoComplete="email"
            editable={!busy && state.available}
            keyboardType="email-address"
            onChangeText={setEmail}
            onSubmitEditing={() => passwordInputRef.current?.focus()}
            placeholder={strings.settings.cloud.signIn.emailPlaceholder}
            placeholderTextColor="#4a7a8a"
            returnKeyType="next"
            submitBehavior="submit"
            style={s.input}
            value={email}
          />
          <TextInput
            accessibilityLabel={strings.settings.cloud.signIn.passwordAccessibility}
            accessibilityHint={strings.settings.cloud.signIn.passwordHint}
            accessibilityState={{ disabled: busy || !state.available }}
            autoCapitalize="none"
            autoComplete="current-password"
            editable={!busy && state.available}
            onChangeText={setPassword}
            onSubmitEditing={signIn}
            placeholder={strings.settings.cloud.signIn.passwordPlaceholder}
            placeholderTextColor="#4a7a8a"
            ref={passwordInputRef}
            returnKeyType="done"
            secureTextEntry
            style={s.input}
            value={password}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={busy ? strings.settings.cloud.signIn.busyAccessibility : strings.settings.cloud.signIn.accessibility}
            accessibilityHint={strings.settings.cloud.signIn.hint}
            accessibilityState={{ disabled: busy || !state.available, busy }}
            disabled={busy || !state.available}
            onPress={signIn}
            style={[s.primaryBtn, (busy || !state.available) && s.disabled]}
          >
            <Ionicons name="log-in-outline" size={17} color="#fff" />
            <Text style={s.primaryText}>{strings.settings.cloud.signIn.action}</Text>
          </TouchableOpacity>
        </View>
      )}
      {state?.signedIn && (
        <>
          <View style={s.accountRow}>
            <View style={s.accountText}>
              <Text style={s.label}>{strings.settings.cloud.accountTitle}</Text>
              <Text style={s.sub}>{state.email}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={busy ? strings.settings.cloud.signOut.busyAccessibility : strings.settings.cloud.signOut.accessibility}
              accessibilityHint={strings.settings.cloud.signOut.hint}
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={signOut}
              style={[s.signOutBtn, busy && s.disabled]}
            >
              <Text style={s.signOutText}>{strings.settings.cloud.signOut.action}</Text>
            </TouchableOpacity>
          </View>
          <View style={s.div} />
          <View style={s.row}>
            <View style={s.rowL}>
              <Ionicons name="cloud-upload-outline" size={18} color="#60a5fa" />
              <View style={s.accountText}>
                <Text style={s.label}>{strings.settings.cloud.sharing.title}</Text>
                <Text style={s.sub}>{strings.settings.cloud.sharing.detail}</Text>
              </View>
            </View>
            <Switch
              accessibilityLabel={strings.settings.cloud.sharing.title}
              accessibilityHint={strings.settings.cloud.sharing.hint}
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
              accessibilityLabel={strings.settings.cloud.links.forgotPasswordAccessibility}
              accessibilityHint={strings.settings.cloud.links.forgotPasswordHint}
              onPress={() => { void openAccountPage('reset'); }}
              style={s.linkBtn}
            >
              <Text style={s.linkText}>{strings.settings.cloud.links.forgotPassword}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="link"
              accessibilityLabel={strings.settings.cloud.links.createAccountAccessibility}
              accessibilityHint={strings.settings.cloud.links.createAccountHint}
              onPress={() => { void openAccountPage('create'); }}
              style={s.linkBtn}
            >
              <Text style={s.linkText}>{strings.settings.cloud.links.createAccount}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          accessibilityRole="link"
          accessibilityLabel={strings.settings.cloud.links.manageAccountAccessibility}
          accessibilityHint={strings.settings.cloud.links.manageAccountHint}
          onPress={() => { void openAccountPage('manage'); }}
          style={s.linkBtn}
        >
          <Text style={s.linkText}>{strings.settings.cloud.links.manageAccount}</Text>
        </TouchableOpacity>
        <Text style={s.statusDetail}>{strings.settings.cloud.links.signInDetail}</Text>
      </View>

      {eventRetry && (
        <View accessibilityRole="text" style={s.statusCheck}>
          <Text style={s.label}>{strings.settings.cloud.alertRetry.title}</Text>
          <Text style={s.statusDetail}>
            {eventRetry.unavailable
              ? strings.settings.cloud.alertRetry.unavailable
              : formatString(strings.settings.cloud.alertRetry.counts, { pending: String(eventRetry.pending), capacityRejected: String(eventRetry.capacityRejected), expired: String(eventRetry.expired), permanentRejected: String(eventRetry.permanentRejected), exhausted: String(eventRetry.exhausted), stopped: String(eventRetry.stopped) })}
          </Text>
          <Text style={s.statusDetail}>{strings.settings.cloud.alertRetry.limits}</Text>
        </View>
      )}

      <View style={s.privacy}>
        <Ionicons name="shield-checkmark-outline" size={14} color="#4a7a8a" />
        <Text style={s.privacyText}>{strings.settings.cloud.privacyDetail}</Text>
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
