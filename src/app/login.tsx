import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { useAuthSession } from '@/src/providers/auth-session';
import { biometricAvailability, promptBiometric } from '@/src/services/auth/biometric';
import {
  isBiometricLoginEnabled,
  isRememberEnabled,
  readRememberedCredentials,
  readRememberedEmail,
  rememberEmailOnly,
  setBiometricLoginEnabled,
  setRememberEnabled,
} from '@/src/services/auth/credentials';
import { signInWithRememberedCredentials } from '@/src/services/auth/restore';
import {
  confirmFirebaseLink,
  readSyncSession,
  registerFirebaseEmail,
  signInFirebaseEmail,
  signInFirebaseGoogle,
  type SyncSession,
} from '@/src/services/sync/runtime';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';

export default function LoginScreen() {
  const bump = useDataStore((state) => state.bump);
  const { notifySignedIn } = useAuthSession();
  const [session, setSession] = useState<SyncSession | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Vân tay');
  const [biometricReason, setBiometricReason] = useState<string | null>(null);
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [nextSession, rememberedEmail, rememberEnabled, biometricEnabled, stored, availability] = await Promise.all([
      readSyncSession(),
      readRememberedEmail(),
      isRememberEnabled(),
      isBiometricLoginEnabled(),
      readRememberedCredentials(),
      biometricAvailability(),
    ]);
    setSession(nextSession);
    setEmail(nextSession.email ?? rememberedEmail ?? '');
    setRemember(rememberEnabled);
    setBiometric(biometricEnabled);
    setBiometricLabel(availability.label);
    setBiometricReason(availability.reason);
    setHasStoredPassword(Boolean(stored));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  async function finishLogin() {
    try {
      const next = await readSyncSession();
      if (next.link === 'confirm') {
        await confirmFirebaseLink();
      }
    } catch {
      // Vẫn vào app; có thể gắn / đồng bộ lại trong Cài đặt → Đồng bộ đám mây.
    }
    bump();
    await notifySignedIn();
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (error) {
      Alert.alert('Đăng nhập', error instanceof Error ? error.message : 'Không đăng nhập được.');
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRemember(value: boolean) {
    setRemember(value);
    await setRememberEnabled(value);
    if (!value) {
      setBiometric(false);
      await setBiometricLoginEnabled(false);
    }
  }

  async function toggleBiometric(value: boolean) {
    if (value) {
      const availability = await biometricAvailability();
      if (!availability.available) {
        Alert.alert(availability.label, availability.reason ?? 'Máy chưa hỗ trợ mở khóa nhanh.');
        return;
      }
      if (!remember) {
        setRemember(true);
        await setRememberEnabled(true);
      }
      const ok = await promptBiometric(`Bật đăng nhập bằng ${availability.label.toLowerCase()}`);
      if (!ok) {
        return;
      }
    }
    setBiometric(value);
    await setBiometricLoginEnabled(value);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppText variant="heading">AiTiMan Moni</AppText>
        <AppText color={colors.textSecondary}>
          Đăng nhập hoặc tạo tài khoản để dùng sổ chi tiêu và đồng bộ giữa các máy của bạn.
        </AppText>
        {session?.nativeReason ? <AppText color={colors.expense}>{session.nativeReason}</AppText> : null}

        <Button
          label="Đăng nhập Google"
          variant="secondary"
          disabled={busy || !session?.nativeReady || !session.googleSignInReady}
          onPress={() =>
            void run(async () => {
              await signInFirebaseGoogle();
              const next = await readSyncSession();
              if (next.email) {
                await rememberEmailOnly(next.email);
                setEmail(next.email);
              }
              if (biometric) {
                await setBiometricLoginEnabled(true);
              }
              await finishLogin();
            })
          }
        />
        {session?.googleSignInReason ? (
          <AppText variant="caption" color={colors.textSecondary}>{session.googleSignInReason}</AppText>
        ) : null}

        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="Email"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Mật khẩu"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />

        <Card style={styles.card}>
          <Row label="Nhớ mật khẩu trên máy" value={remember} onChange={(value) => void toggleRemember(value)} />
          <Row
            label={`Bật ${biometricLabel.toLowerCase()} sau khi đăng nhập`}
            value={biometric}
            onChange={(value) => void toggleBiometric(value)}
          />
        </Card>
        {biometricReason && !biometric ? (
          <AppText variant="caption" color={colors.textSecondary}>{biometricReason}</AppText>
        ) : null}

        <Button
          label="Đăng nhập email"
          disabled={busy || !session?.nativeReady}
          onPress={() =>
            void run(async () => {
              await signInFirebaseEmail(email, password, { remember: remember || biometric });
              if (biometric) {
                await setBiometricLoginEnabled(true);
              }
              setPassword('');
              await finishLogin();
            })
          }
        />
        <Button
          label="Tạo tài khoản email"
          variant="secondary"
          disabled={busy || !session?.nativeReady}
          onPress={() =>
            void run(async () => {
              await registerFirebaseEmail(email, password, { remember: remember || biometric });
              if (biometric) {
                await setBiometricLoginEnabled(true);
              }
              setPassword('');
              await finishLogin();
            })
          }
        />
        {hasStoredPassword && biometric ? (
          <Button
            label={`Mở bằng ${biometricLabel.toLowerCase()}`}
            variant="ghost"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const ok = await promptBiometric('Đăng nhập AiTiMan Moni');
                if (!ok) {
                  throw new Error('Chưa xác thực được. Thử lại nhé.');
                }
                await signInWithRememberedCredentials();
                await finishLogin();
              })
            }
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.row}>
      <AppText style={styles.flex}>{label}</AppText>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primarySoft, false: colors.divider }}
        thumbColor={value ? colors.primary : '#f4f4f4'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    paddingBottom: 40,
  },
  card: { paddingVertical: 4, paddingHorizontal: 12 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: colors.text,
  },
});
