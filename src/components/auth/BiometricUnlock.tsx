import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { promptBiometric } from '@/src/services/auth/biometric';
import { unlockWithBiometric } from '@/src/services/auth/restore';
import { colors } from '@/src/theme/tokens';

interface BiometricUnlockProps {
  email: string;
  onUnlocked: () => void;
  onUsePassword: () => void;
}

export function BiometricUnlock({ email, onUnlocked, onUsePassword }: BiometricUnlockProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const ok = await promptBiometric('Mở AiTiMan Moni');
      if (!ok) {
        setError('Chưa xác thực được. Thử lại hoặc đăng nhập bằng cách khác.');
        return;
      }
      await unlockWithBiometric();
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không mở được bằng sinh trắc học.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <AppText variant="heading">Mở khóa nhanh</AppText>
      <AppText color={colors.textSecondary}>Tài khoản: {email}</AppText>
      {error ? <AppText color={colors.expense}>{error}</AppText> : null}
      <Button label="Mở bằng vân tay / Face ID" loading={busy} onPress={() => void unlock()} />
      <Button label="Đăng nhập bằng cách khác" variant="secondary" disabled={busy} onPress={onUsePassword} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
});
