import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getDatabase } from '@/src/database/expo-client';
import { getActiveBudget, listBudgets } from '@/src/database/repositories/budgets';
import { listCategories } from '@/src/database/repositories/categories';
import { getPreference, preferenceKeys, setPreference } from '@/src/database/repositories/preferences';
import { listRecurringRules } from '@/src/database/repositories/recurring';
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

  const recurring = (await listRecurringRules(db)).filter((rule) => rule.mode === 'reminder');
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const recurringIds = new Set(recurring.map((rule) => `recurring-${rule.id}-${rule.nextOccurrenceDate}`));
  await Promise.all(
    scheduled
      .filter((item) => item.identifier.startsWith('recurring-') && !recurringIds.has(item.identifier))
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
  if (!enabled && !weekly && recurring.length === 0) {
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

  for (const rule of recurring) {
    const markerKey = `recurring_notification_${rule.id}`;
    if ((await getPreference(db, markerKey)) === rule.nextOccurrenceDate) {
      continue;
    }
    const date = new Date(`${rule.nextOccurrenceDate}T09:00:00`);
    const triggerDate = date.getTime() <= Date.now() ? new Date(Date.now() + 2_000) : date;
    await Notifications.scheduleNotificationAsync({
      identifier: `recurring-${rule.id}-${rule.nextOccurrenceDate}`,
      content: {
        title: 'Giao dịch chờ xác nhận',
        body: `${rule.description || 'Khoản định kỳ'} · ${formatVnd(rule.amount)}`,
        data: { recurringRuleId: rule.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        channelId: 'reminders',
      },
    });
    await setPreference(db, markerKey, rule.nextOccurrenceDate);
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
  const [overallBudget, budgetHistory, categories] = await Promise.all([
    getActiveBudget(db, null, todayIso),
    listBudgets(db),
    listCategories(db),
  ]);
  const categoryBudgets = budgetHistory.filter((budget, index, all) =>
    budget.categoryId != null
    && budget.effectiveDate <= todayIso
    && all.findIndex((candidate) => candidate.categoryId === budget.categoryId && candidate.effectiveDate <= todayIso) === index,
  );
  const budgets = [...(overallBudget ? [overallBudget] : []), ...categoryBudgets];
  if (budgets.length === 0) {
    return;
  }
  const range = getComparisonRanges('month', today);
  const monthKey = todayIso.slice(0, 7);
  for (const budget of budgets) {
    const spent = await sumAmount(db, {
      type: 'expense',
      start: range.current.start,
      end: range.current.end,
      categoryId: budget.categoryId,
    });
    const progress = evaluateBudget(
      spent,
      budget.amount,
      budget.warningThresholdBps / 10_000,
      budget.limitThresholdBps / 10_000,
    );
    if (!progress.alertKey) continue;

    const alertPreference = budget.categoryId
      ? `${preferenceKeys.lastBudgetAlert}_${budget.categoryId}`
      : preferenceKeys.lastBudgetAlert;
    const lastAlert = await getPreference(db, alertPreference);
    if (!shouldSendBudgetAlert(monthKey, progress.alertKey, lastAlert)) continue;

    const exceeded = progress.alertKey === '100';
    const categoryName = categories.find((category) => category.id === budget.categoryId)?.name;
    await ensureNotificationChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: exceeded ? 'Đã vượt ngân sách' : 'Sắp chạm ngân sách',
        body: exceeded
          ? `${categoryName ? `${categoryName}: ` : ''}${formatVnd(spent)} trên ${formatVnd(budget.amount)}.`
          : `${categoryName ? `${categoryName} đã` : 'Bạn đã'} dùng khoảng ${Math.round(budget.warningThresholdBps / 100)}% ngân sách.`,
      },
      trigger: Platform.OS === 'android' ? { channelId: 'reminders' } : null,
    });
    await setPreference(db, alertPreference, `${monthKey}-${progress.alertKey}`);
  }
}
