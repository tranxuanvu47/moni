import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getDatabase } from '@/src/database/expo-client';
import { getActiveBudget } from '@/src/database/repositories/budgets';
import { getPreference, preferenceKeys, setPreference } from '@/src/database/repositories/preferences';
import { sumAmount } from '@/src/database/repositories/transactions';
import { evaluateBudget, shouldSendBudgetAlert } from '@/src/features/budgets/thresholds';
import { formatIsoDate, getComparisonRanges, localDateFromDate } from '@/src/utils/dates';
import { formatVnd } from '@/src/utils/money';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Nhắc nhở',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export async function syncScheduledReminders(): Promise<void> {
  const db = getDatabase();
  const enabled = (await getPreference(db, preferenceKeys.reminderEnabled)) === '1';
  const weekly = (await getPreference(db, preferenceKeys.weeklyRecapEnabled)) === '1';
  const hour = Number((await getPreference(db, preferenceKeys.reminderHour)) ?? '21');
  const minute = Number((await getPreference(db, preferenceKeys.reminderMinute)) ?? '0');

  await Notifications.cancelScheduledNotificationAsync('daily-reminder').catch(() => undefined);
  await Notifications.cancelScheduledNotificationAsync('weekly-recap').catch(() => undefined);

  if (!enabled && !weekly) {
    return;
  }

  await ensureNotificationChannel();

  if (enabled) {
    await Notifications.scheduleNotificationAsync({
      identifier: 'daily-reminder',
      content: {
        title: 'Ghi lại chi tiêu',
        body: 'Dành một phút để ghi khoản chi hôm nay.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: Number.isInteger(hour) ? hour : 21,
        minute: Number.isInteger(minute) ? minute : 0,
        channelId: 'reminders',
      },
    });
  }

  if (weekly) {
    const today = localDateFromDate(new Date());
    const range = getComparisonRanges('week', today);
    const spent = await sumAmount(db, { type: 'expense', start: range.current.start, end: range.current.end });
    const body = spent > 0 ? `Tuần này bạn đã chi ${formatVnd(spent)}.` : 'Tuần này chưa có khoản chi nào được ghi.';
    await Notifications.scheduleNotificationAsync({
      identifier: 'weekly-recap',
      content: { title: 'Tổng kết tuần', body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: 1,
        hour: 19,
        minute: 0,
        channelId: 'reminders',
      },
    });
  }
}

export async function reviewBudgetAlert(): Promise<void> {
  const db = getDatabase();
  if ((await getPreference(db, preferenceKeys.budgetAlertEnabled)) !== '1') {
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    return;
  }

  const today = localDateFromDate(new Date());
  const todayIso = formatIsoDate(today);
  const budget = await getActiveBudget(db, null, todayIso);
  if (!budget) {
    return;
  }
  const range = getComparisonRanges('month', today);
  const spent = await sumAmount(db, { type: 'expense', start: range.current.start, end: range.current.end });
  const progress = evaluateBudget(spent, budget.amount);
  if (!progress.alertKey) {
    return;
  }

  const monthKey = todayIso.slice(0, 7);
  const lastAlert = await getPreference(db, preferenceKeys.lastBudgetAlert);
  if (!shouldSendBudgetAlert(monthKey, progress.alertKey, lastAlert)) {
    return;
  }

  const exceeded = progress.alertKey === '100';
  await ensureNotificationChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: exceeded ? 'Đã vượt ngân sách tháng' : 'Sắp chạm ngân sách tháng',
      body: exceeded
        ? `Chi tiêu đã đạt ${formatVnd(spent)} trên ngân sách ${formatVnd(budget.amount)}.`
        : `Bạn đã dùng khoảng 80% ngân sách tháng.`,
    },
    trigger: Platform.OS === 'android' ? { channelId: 'reminders' } : null,
  });
  await setPreference(db, preferenceKeys.lastBudgetAlert, `${monthKey}-${progress.alertKey}`);
}
