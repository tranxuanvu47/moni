import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { StackHeader } from '@/src/components/ui/Header';
import { NumericKeypad } from '@/src/components/ui/NumericKeypad';
import { ProgressBar } from '@/src/components/ui/AmountText';
import { LoadingState, MessageState } from '@/src/components/ui/StateView';
import { getDatabase } from '@/src/database/expo-client';
import { deleteBudget, getActiveBudget, listBudgets, upsertMonthlyBudget } from '@/src/database/repositories/budgets';
import { listCategories } from '@/src/database/repositories/categories';
import { sumAmount } from '@/src/database/repositories/transactions';
import { evaluateBudget } from '@/src/features/budgets/thresholds';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Budget, Category } from '@/src/types/finance';
import { formatIsoDate, getComparisonRanges, localDateFromDate } from '@/src/utils/dates';
import { formatVnd } from '@/src/utils/money';

export default function BudgetScreen() {
  const bump = useDataStore((state) => state.bump);
  const [amount, setAmount] = useState(0);
  const [spent, setSpent] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryAmount, setCategoryAmount] = useState(0);
  const [warningThreshold, setWarningThreshold] = useState('80');
  const [limitThreshold, setLimitThreshold] = useState('100');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const today = formatIsoDate(localDateFromDate(new Date()));

  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const db = getDatabase();
      const range = getComparisonRanges('month', localDateFromDate(new Date()));
      const [budget, categoryList, budgetList, monthSpent] = await Promise.all([
        getActiveBudget(db, null, today),
        listCategories(db),
        listBudgets(db),
        sumAmount(db, { type: 'expense', start: range.current.start, end: range.current.end }),
      ]);
      setAmount(budget?.amount ?? 0);
      setWarningThreshold(String(Math.round((budget?.warningThresholdBps ?? 8000) / 100)));
      setLimitThreshold(String(Math.round((budget?.limitThresholdBps ?? 10000) / 100)));
      setSpent(monthSpent);
      setCategories(categoryList.filter((category) => category.type !== 'income'));
      setBudgets(budgetList.filter((item) => item.categoryId));
      setLoadedOnce(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không tải được hũ chi tiêu.');
    } finally {
      setLoading(false);
    }
  }, [today]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function saveOverall() {
    if (amount <= 0 || saving) {
      return;
    }
    setSaving(true);
    try {
      await upsertMonthlyBudget(getDatabase(), {
        categoryId: null,
        amount,
        effectiveDate: `${today.slice(0, 8)}01`,
        warningThresholdBps: Number(warningThreshold) * 100,
        limitThresholdBps: Number(limitThreshold) * 100,
      });
      bump();
      await reload();
    } catch (nextError) {
      Alert.alert('Hũ chi tiêu', nextError instanceof Error ? nextError.message : 'Không lưu được hũ chi tiêu.');
    } finally {
      setSaving(false);
    }
  }

  async function saveCategory() {
    if (!categoryId || categoryAmount <= 0 || saving) {
      return;
    }
    setSaving(true);
    try {
      await upsertMonthlyBudget(getDatabase(), {
        categoryId,
        amount: categoryAmount,
        effectiveDate: `${today.slice(0, 8)}01`,
      });
      bump();
      setCategoryAmount(0);
      await reload();
    } catch (nextError) {
      Alert.alert('Hũ hạng mục', nextError instanceof Error ? nextError.message : 'Không lưu được hũ hạng mục.');
    } finally {
      setSaving(false);
    }
  }

  async function removeBudget(id: string) {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await deleteBudget(getDatabase(), id);
      bump();
      await reload();
    } catch (nextError) {
      Alert.alert('Hũ chi tiêu', nextError instanceof Error ? nextError.message : 'Không xóa được hũ chi tiêu.');
    } finally {
      setSaving(false);
    }
  }

  const progress = evaluateBudget(spent, amount || null);
  const hasLoadedData = loadedOnce || categories.length > 0 || budgets.length > 0 || amount > 0 || spent > 0;

  return (
    <View style={styles.screen}>
      <StackHeader title="Hũ chi tiêu" />
      {!hasLoadedData && loading ? <LoadingState label="Đang tải hũ chi tiêu" /> : null}
      {!hasLoadedData && error ? (
        <MessageState title="Chưa tải được hũ chi tiêu" message={error} actionLabel="Thử lại" onAction={() => void reload()} />
      ) : null}
      {hasLoadedData ? (
        <ScrollView contentContainerStyle={styles.content}>
          {error ? (
            <Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.inlineError}>
              <AppText variant="caption" color={colors.expenseText}>{error} Chạm để thử lại.</AppText>
            </Pressable>
          ) : null}
          {loading ? <LoadingState label="Đang làm mới hũ chi tiêu" /> : null}
          <Card>
            <AppText variant="bodyMedium">Tháng này đã chi {formatVnd(spent)}</AppText>
            {amount > 0 ? (
              <>
                <ProgressBar ratio={progress.ratio} />
                <AppText variant="caption" color={colors.textSecondary}>
                  Còn {formatVnd(Math.max(progress.remaining, 0))}
                </AppText>
              </>
            ) : (
              <AppText color={colors.textSecondary}>Chưa đặt hạn mức tháng.</AppText>
            )}
          </Card>
          <AppText variant="heading">Hũ cả tháng</AppText>
          <NumericKeypad amount={amount} onChange={setAmount} />
          <View style={styles.thresholds}>
            <View style={styles.thresholdField}>
              <AppText variant="label" color={colors.textMuted}>Cảnh báo (%)</AppText>
              <TextInput value={warningThreshold} onChangeText={setWarningThreshold} keyboardType="number-pad" style={styles.input} accessibilityLabel="Ngưỡng cảnh báo phần trăm" />
            </View>
            <View style={styles.thresholdField}>
              <AppText variant="label" color={colors.textMuted}>Giới hạn (%)</AppText>
              <TextInput value={limitThreshold} onChangeText={setLimitThreshold} keyboardType="number-pad" style={styles.input} accessibilityLabel="Ngưỡng giới hạn phần trăm" />
            </View>
          </View>
          <Button label="Lưu hũ chi tiêu" onPress={() => void saveOverall()} loading={saving} disabled={amount <= 0 || !validThresholds(warningThreshold, limitThreshold)} />
          <AppText variant="heading">Hũ theo hạng mục</AppText>
          <View style={styles.row}>
            {categories.map((category) => (
              <Button
                key={category.id}
                label={category.name}
                variant={categoryId === category.id ? 'primary' : 'secondary'}
                onPress={() => setCategoryId(category.id)}
                style={styles.category}
              />
            ))}
          </View>
          <NumericKeypad amount={categoryAmount} onChange={setCategoryAmount} />
          <Button label="Lưu hũ hạng mục" variant="secondary" onPress={() => void saveCategory()} loading={saving} disabled={!categoryId || categoryAmount <= 0} />
          {budgets.map((budget) => {
            const category = categories.find((item) => item.id === budget.categoryId);
            return (
              <View key={budget.id} style={styles.budgetRow}>
                <AppText style={styles.flex}>{category?.name ?? 'Hạng mục'}</AppText>
                <AppText>{formatVnd(budget.amount)}</AppText>
                <Button label="Xóa" variant="ghost" onPress={() => void removeBudget(budget.id)} disabled={saving} />
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  category: { minHeight: 40, paddingHorizontal: 10 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  thresholds: { flexDirection: 'row', gap: 12 },
  thresholdField: { flex: 1, gap: 4 },
  inlineError: { borderRadius: radius.md, backgroundColor: colors.expenseSoft, padding: 12 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: 12, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.text, fontFamily: 'Inter_400Regular' },
});

function validThresholds(warning: string, limit: string): boolean {
  const first = Number(warning);
  const second = Number(limit);
  return Number.isInteger(first) && Number.isInteger(second) && first > 0 && first < second && second <= 1000;
}
