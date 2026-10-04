import { useCallback, useState } from 'react';
import { Alert, AppState, Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { StackHeader } from '@/src/components/ui/Header';
import { getDatabase } from '@/src/database/expo-client';
import { getPreference, preferenceKeys, setPreference } from '@/src/database/repositories/preferences';
import { BANK_PACKAGE_LABELS } from '@/src/features/bank/packages';
import { bankListenerAvailability, getNativeBankListener } from '@/src/services/bank/native-listener';
import { colors } from '@/src/theme/tokens';

export default function BankNotificationsScreen() {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState(false);
  const availability = bankListenerAvailability();

  const reload = useCallback(async () => {
    const db = getDatabase();
    setEnabled((await getPreference(db, preferenceKeys.bankNotificationsEnabled)) === '1');
    const native = getNativeBankListener();
    setPermission(Boolean(native?.isNotificationPermissionGranted()));
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

  async function toggle(value: boolean) {
    if (value) {
      if (!availability.ready) {
        Alert.alert('Thông báo ngân hàng', availability.reason ?? 'Chưa hỗ trợ trên máy này.');
        return;
      }
      const native = getNativeBankListener();
      if (!native?.isNotificationPermissionGranted()) {
        Alert.alert(
          'Cần quyền đọc thông báo',
          'Android yêu cầu bật Quyền truy cập thông báo cho AiTiMan Moni. Chỉ các app ngân hàng/ví trong danh sách được đọc để tạo giao dịch.',
          [
            { text: 'Để sau', style: 'cancel' },
            {
              text: 'Mở cài đặt',
              onPress: () => native?.openNotificationListenerSettings(),
            },
          ],
        );
        return;
      }
    }
    setEnabled(value);
    await setPreference(getDatabase(), preferenceKeys.bankNotificationsEnabled, value ? '1' : '0');
  }

  const labels = Object.values(BANK_PACKAGE_LABELS).filter((name, index, all) => all.indexOf(name) === index);

  return (
    <View style={styles.screen}>
      <StackHeader title="Thông báo ngân hàng" />
      <ScrollView contentContainerStyle={styles.content}>
        <AppText>
          Khi bật, app đọc thông báo từ app ngân hàng hoặc tin nhắn trên Android, tách số tiền và lưu giao dịch vào sổ máy. OTP và thông báo không có số tiền sẽ bị bỏ qua. iOS không cho đọc thông báo app khác.
        </AppText>
        {availability.reason ? <AppText color={colors.expense}>{availability.reason}</AppText> : null}
        <Card style={styles.card}>
          <View style={styles.row}>
            <AppText style={styles.flex}>Tự lưu giao dịch từ thông báo</AppText>
            <Switch
              value={enabled}
              onValueChange={(value) => void toggle(value)}
              trackColor={{ true: colors.primarySoft, false: colors.divider }}
              thumbColor={enabled ? colors.primary : '#f4f4f4'}
            />
          </View>
        </Card>
        <AppText color={colors.textSecondary}>
          Quyền truy cập thông báo: {Platform.OS !== 'android' ? 'không áp dụng' : permission ? 'đã bật' : 'chưa bật'}
        </AppText>
        {availability.ready ? (
          <Button
            label="Mở cài đặt quyền thông báo"
            variant="secondary"
            onPress={() => getNativeBankListener()?.openNotificationListenerSettings()}
          />
        ) : null}
        <AppText variant="caption" color={colors.textSecondary}>
          Ứng dụng được lọc: {labels.join(', ')} và một số app ngân hàng/ví khác.
        </AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  card: { paddingHorizontal: 12, paddingVertical: 4 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
