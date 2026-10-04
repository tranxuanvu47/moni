import { useCallback, useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { StackHeader } from '@/src/components/ui/Header';
import { getDatabase } from '@/src/database/expo-client';
import { getPreference, preferenceKeys, setPreference } from '@/src/database/repositories/preferences';
import { permissionDeniedMessage } from '@/src/services/ai/errors';
import { syncScheduledReminders } from '@/src/services/notifications/reminders';
import { colors } from '@/src/theme/tokens';

export default function RemindersScreen() {
  const [daily, setDaily] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [budgetAlert, setBudgetAlert] = useState(true);
  const [hour, setHour] = useState(21);
  const [minute, setMinute] = useState(0);
  const [showTime, setShowTime] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const db = getDatabase();
      void (async () => {
        setDaily((await getPreference(db, preferenceKeys.reminderEnabled)) === '1');
        setWeekly((await getPreference(db, preferenceKeys.weeklyRecapEnabled)) === '1');
        setBudgetAlert((await getPreference(db, preferenceKeys.budgetAlertEnabled)) !== '0');
        setHour(Number((await getPreference(db, preferenceKeys.reminderHour)) ?? '21'));
        setMinute(Number((await getPreference(db, preferenceKeys.reminderMinute)) ?? '0'));
      })();
    }, []),
  );

  async function persist(next: { daily?: boolean; weekly?: boolean; budgetAlert?: boolean; hour?: number; minute?: number }) {
    const db = getDatabase();
    const dailyValue = next.daily ?? daily;
    const weeklyValue = next.weekly ?? weekly;
    const needsPermission = dailyValue || weeklyValue || (next.budgetAlert ?? budgetAlert);
    if (needsPermission && (next.daily || next.weekly || next.budgetAlert)) {
      const current = await Notifications.getPermissionsAsync();
      if (!current.granted) {
        const asked = await Notifications.requestPermissionsAsync();
        if (!asked.granted) {
          Alert.alert('Thông báo', permissionDeniedMessage('notifications'));
          return;
        }
      }
    }
    if (next.daily != null) {
      setDaily(next.daily);
      await setPreference(db, preferenceKeys.reminderEnabled, next.daily ? '1' : '0');
    }
    if (next.weekly != null) {
      setWeekly(next.weekly);
      await setPreference(db, preferenceKeys.weeklyRecapEnabled, next.weekly ? '1' : '0');
    }
    if (next.budgetAlert != null) {
      setBudgetAlert(next.budgetAlert);
      await setPreference(db, preferenceKeys.budgetAlertEnabled, next.budgetAlert ? '1' : '0');
    }
    if (next.hour != null) {
      setHour(next.hour);
      await setPreference(db, preferenceKeys.reminderHour, String(next.hour));
    }
    if (next.minute != null) {
      setMinute(next.minute);
      await setPreference(db, preferenceKeys.reminderMinute, String(next.minute));
    }
    await syncScheduledReminders();
  }

  function onTime(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS !== 'ios') {
      setShowTime(false);
    }
    if (event.type !== 'dismissed' && selected) {
      void persist({ hour: selected.getHours(), minute: selected.getMinutes() });
    }
  }

  const time = new Date();
  time.setHours(hour, minute, 0, 0);

  return (
    <View style={styles.screen}>
      <StackHeader title="Nhắc nhở" />
      <View style={styles.content}>
        <Card style={styles.card}>
          <Row label="Nhắc ghi chi tiêu mỗi ngày" value={daily} onChange={(value) => void persist({ daily: value })} />
          <Row label="Tổng kết cuối tuần" value={weekly} onChange={(value) => void persist({ weekly: value })} />
          <Row label="Báo khi chạm 80% hoặc vượt ngân sách" value={budgetAlert} onChange={(value) => void persist({ budgetAlert: value })} />
        </Card>
        <AppText color={colors.textSecondary}>Giờ nhắc hằng ngày: {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}</AppText>
        <Button label="Đổi giờ" variant="secondary" onPress={() => setShowTime(true)} />
        {showTime ? (
          <View>
            <DateTimePicker value={time} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={onTime} />
            {Platform.OS === 'ios' ? <Button label="Xong" variant="ghost" onPress={() => setShowTime(false)} /> : null}
          </View>
        ) : null}
        <AppText variant="caption" color={colors.textSecondary}>
          Quyền thông báo chỉ được hỏi khi bạn bật một nhắc nhở. Mỗi mốc ngân sách chỉ báo một lần trong tháng.
        </AppText>
      </View>
    </View>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.row}>
      <AppText style={styles.flex}>{label}</AppText>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.divider }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12 },
  card: { padding: 0 },
  row: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  flex: { flex: 1 },
});
