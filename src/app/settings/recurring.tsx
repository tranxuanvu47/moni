import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { CategoryPicker, SegmentedControl } from '@/src/components/ui/Pickers';
import { getDatabase } from '@/src/database/expo-client';
import { listAccounts } from '@/src/database/repositories/accounts';
import { listCategories } from '@/src/database/repositories/categories';
import {
  advanceRecurringReminder,
  createRecurringRule,
  deleteRecurringRule,
  listRecurringRules,
  setRecurringRuleEnabled,
} from '@/src/database/repositories/recurring';
import { createTransaction } from '@/src/database/repositories/transactions';
import { syncScheduledReminders } from '@/src/services/notifications/reminders';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Account, Category, RecurrenceFrequency, RecurringMode, RecurringRule, TransactionType } from '@/src/types/finance';
import { formatIsoDate, localDateFromDate } from '@/src/utils/dates';
import { formatVnd } from '@/src/utils/money';

const FREQUENCIES: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'weekly', label: 'Tuần' },
  { value: 'monthly', label: 'Tháng' },
  { value: 'yearly', label: 'Năm' },
];

export default function RecurringScreen() {
  const insets = useSafeAreaInsets();
  const bump = useDataStore((state) => state.bump);
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('monthly');
  const [mode, setMode] = useState<RecurringMode>('reminder');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const db = getDatabase();
    const [nextRules, nextCategories, nextAccounts] = await Promise.all([
      listRecurringRules(db, { includeDisabled: true }),
      listCategories(db),
      listAccounts(db),
    ]);
    setRules(nextRules);
    setCategories(nextCategories);
    setAccounts(nextAccounts);
    setCategoryId((current) => current ?? nextCategories.find((item) => item.id === 'cat_food')?.id ?? nextCategories[0]?.id ?? null);
    setAccountId((current) => current ?? nextAccounts[0]?.id ?? null);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save() {
    const parsed = Number(amount.replace(/\D/g, ''));
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || !categoryId || !accountId) return;
    setSaving(true);
    try {
      await createRecurringRule(getDatabase(), {
        type,
        amount: parsed,
        categoryId,
        accountId,
        description,
        startDate: formatIsoDate(localDateFromDate(new Date())),
        frequency,
        mode,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok',
      });
      if (mode === 'reminder') {
        await Notifications.requestPermissionsAsync();
      }
      await syncScheduledReminders();
      setOpen(false);
      setAmount('');
      setDescription('');
      await load();
    } catch (error) {
      Alert.alert('Giao dịch định kỳ', error instanceof Error ? error.message : 'Không lưu được quy tắc.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmReminder(rule: RecurringRule) {
    try {
      await createTransaction(getDatabase(), {
        type: rule.type,
        amount: rule.amount,
        categoryId: rule.categoryId,
        accountId: rule.accountId,
        description: rule.description,
        occurredAt: `${rule.nextOccurrenceDate}T09:00:00`,
        recurringRuleId: rule.id,
        occurrenceKey: `${rule.id}:${rule.nextOccurrenceDate}`,
      });
      await advanceRecurringReminder(getDatabase(), rule.id, rule.nextOccurrenceDate);
      await syncScheduledReminders();
      bump();
      await load();
    } catch (error) {
      Alert.alert('Giao dịch định kỳ', error instanceof Error ? error.message : 'Không tạo được giao dịch.');
    }
  }

  function remove(rule: RecurringRule) {
    Alert.alert('Xóa quy tắc?', 'Các giao dịch đã tạo vẫn được giữ lại.', [
      { text: 'Giữ lại', style: 'cancel' },
      { text: 'Xóa', style: 'destructive', onPress: () => void deleteRecurringRule(getDatabase(), rule.id).then(syncScheduledReminders).then(load) },
    ]);
  }

  const today = formatIsoDate(localDateFromDate(new Date()));

  return (
    <View style={styles.screen}>
      <StackHeader title="Giao dịch định kỳ" />
      <ScrollView contentContainerStyle={styles.content}>
        <AppText color={colors.textMuted}>Tự tạo khoản cố định hoặc chỉ nhắc bạn xác nhận khi số tiền có thể thay đổi.</AppText>
        <Button label="Thêm quy tắc" onPress={() => setOpen(true)} />
        {rules.length === 0 ? <AppText color={colors.textMuted}>Chưa có giao dịch định kỳ.</AppText> : null}
        {rules.map((rule) => (
          <View key={rule.id} style={styles.row}>
            <View style={styles.copy}>
              <AppText variant="bodyMedium">{rule.description || (rule.type === 'income' ? 'Thu nhập định kỳ' : 'Chi tiêu định kỳ')}</AppText>
              <AppText variant="caption" color={colors.textMuted}>{formatVnd(rule.amount)} · {frequencyLabel(rule.frequency)} · kỳ tới {displayDate(rule.nextOccurrenceDate)}</AppText>
              <AppText variant="caption" color={rule.enabled ? colors.incomeText : colors.textMuted}>{rule.mode === 'automatic' ? 'Tự động tạo' : 'Nhắc xác nhận'}{rule.enabled ? '' : ' · Đã tắt'}</AppText>
            </View>
            {rule.mode === 'reminder' && rule.enabled && rule.nextOccurrenceDate <= today ? (
              <Pressable accessibilityRole="button" onPress={() => void confirmReminder(rule)}><AppText variant="caption" color={colors.primary}>Xác nhận</AppText></Pressable>
            ) : null}
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: rule.enabled }} onPress={() => void setRecurringRuleEnabled(getDatabase(), rule.id, !rule.enabled).then(syncScheduledReminders).then(load)}>
              <AppText variant="caption" color={colors.primary}>{rule.enabled ? 'Tắt' : 'Bật'}</AppText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => remove(rule)}><AppText variant="caption" color={colors.expenseText}>Xóa</AppText></Pressable>
          </View>
        ))}
      </ScrollView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.dismiss} onPress={() => setOpen(false)} accessibilityLabel="Đóng" />
          <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 20 }} keyboardShouldPersistTaps="handled">
            <AppText variant="heading">Quy tắc mới</AppText>
            <SegmentedControl value={type} onChange={setType} options={[{ value: 'expense', label: 'Chi' }, { value: 'income', label: 'Thu' }]} />
            <TextInput value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="Số tiền (VND)" placeholderTextColor={colors.textMuted} style={styles.input} />
            <TextInput value={description} onChangeText={setDescription} placeholder="Mô tả" placeholderTextColor={colors.textMuted} style={styles.input} />
            <AppText variant="label" color={colors.textMuted}>Hạng mục</AppText>
            <CategoryPicker categories={categories} type={type} selectedId={categoryId} onSelect={(item) => setCategoryId(item.id)} />
            <AppText variant="label" color={colors.textMuted}>Tài khoản</AppText>
            <ScrollView horizontal contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false}>
              {accounts.map((account) => <Choice key={account.id} label={account.name} selected={account.id === accountId} onPress={() => setAccountId(account.id)} />)}
            </ScrollView>
            <AppText variant="label" color={colors.textMuted}>Lặp lại</AppText>
            <SegmentedControl value={frequency} onChange={setFrequency} options={FREQUENCIES} />
            <AppText variant="label" color={colors.textMuted}>Cách xử lý</AppText>
            <SegmentedControl value={mode} onChange={setMode} options={[{ value: 'reminder', label: 'Nhắc xác nhận' }, { value: 'automatic', label: 'Tự động tạo' }]} />
            <Button label="Lưu quy tắc" loading={saving} disabled={!amount || !categoryId || !accountId} onPress={() => void save()} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}><AppText variant="caption" color={selected ? colors.surface : colors.text}>{label}</AppText></Pressable>;
}

function frequencyLabel(value: RecurrenceFrequency) {
  return value === 'daily' ? 'Hằng ngày' : value === 'weekly' ? 'Hằng tuần' : value === 'monthly' ? 'Hằng tháng' : 'Hằng năm';
}

function displayDate(value: string) { return value.split('-').reverse().join('/'); }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, paddingVertical: 12 },
  copy: { flex: 1, gap: 2 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { maxHeight: '86%', backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: 12, color: colors.text, fontFamily: 'Inter_400Regular', marginTop: 12 },
  chips: { gap: 8, paddingVertical: 6 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.divider },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
});
