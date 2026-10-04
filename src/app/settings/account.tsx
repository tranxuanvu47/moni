import { useCallback, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { StackHeader } from '@/src/components/ui/Header';
import { useAuthSession } from '@/src/providers/auth-session';
import { biometricAvailability, promptBiometric } from '@/src/services/auth/biometric';
import {
  isBiometricLoginEnabled,
  rememberEmailOnly,
  setBiometricLoginEnabled,
} from '@/src/services/auth/credentials';
import { readSyncSession, type SyncSession } from '@/src/services/sync/runtime';
import { colors } from '@/src/theme/tokens';

export default function AccountSettingsScreen() {
  const { email: sessionEmail, signOut } = useAuthSession();
  const [session, setSession] = useState<SyncSession | null>(null);
  const [biometric, setBiometric] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Vân tay');
  const [biometricReason, setBiometricReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [nextSession, biometricEnabled, availability] = await Promise.all([
      readSyncSession(),
      isBiometricLoginEnabled(),
      biometricAvailability(),
    ]);
    setSession(nextSession);
    setBiometric(biometricEnabled);
    setBiometricLabel(availability.label);
    setBiometricReason(availability.reason);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          reload().catch(() => undefined);
        }
      });
      return () => sub.remove();
    }, [reload]),
  );

  async function toggleBiometric(value: boolean) {
    if (value) {
      const availability = await biometricAvailability();
      if (!availability.available) {
        Alert.alert(availability.label, availability.reason ?? 'Máy chưa hỗ trợ mở khóa nhanh.');
        return;
      }
      if (!session?.account) {
        Alert.alert('Vân tay', 'Hãy đăng nhập trước rồi bật mở khóa nhanh.');
        return;
      }
      const ok = await promptBiometric(`Bật mở khóa bằng ${availability.label.toLowerCase()}`);
      if (!ok) {
        return;
      }
      if (session.email) {
        await rememberEmailOnly(session.email);
      }
    }
    setBiometric(value);
    await setBiometricLoginEnabled(value);
  }

  const email = session?.email ?? sessionEmail ?? '—';

  return (
    <View style={styles.screen}>
      <StackHeader title="Tài khoản" />
      <ScrollView contentContainerStyle={styles.content}>
        <AppText color={colors.textSecondary}>
          Tài khoản đang dùng trên máy này. Bật vân tay / Face ID để mở app nhanh hơn lần sau.
        </AppText>
        <AppText variant="bodyMedium">{email}</AppText>

        <Card style={styles.card}>
          <Row
            label={`Mở khóa bằng ${biometricLabel.toLowerCase()}`}
            value={biometric}
            onChange={(value) => void toggleBiometric(value)}
          />
        </Card>
        {biometricReason && !biometric ? (
          <AppText variant="caption" color={colors.textSecondary}>{biometricReason}</AppText>
        ) : null}

        <Button
          label="Đăng xuất"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            Alert.alert('Đăng xuất', 'Dữ liệu trên máy vẫn được giữ. Bạn cần đăng nhập lại để tiếp tục dùng app.', [
              { text: 'Ở lại', style: 'cancel' },
              {
                text: 'Đăng xuất',
                style: 'destructive',
                onPress: () => {
                  setBusy(true);
                  void signOut()
                    .catch((error: unknown) => {
                      Alert.alert('Tài khoản', error instanceof Error ? error.message : 'Không đăng xuất được.');
                    })
                    .finally(() => setBusy(false));
                },
              },
            ]);
          }}
        />
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
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  card: { paddingVertical: 4, paddingHorizontal: 12 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
