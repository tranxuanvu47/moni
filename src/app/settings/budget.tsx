import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { StackHeader } from '@/src/components/ui/Header';
import { NumericKeypad } from '@/src/components/ui/NumericKeypad';
import { ProgressBar } from '@/src/components/ui/AmountText';
import { getDatabase } from '@/src/database/expo-client';
import { deleteBudget, getActiveBudget, listBudgets, upsertMonthlyBudget } from '@/src/database/repositories/budgets';
import { listCategories } from '@/src/database/repositories/categories';
import { sumAmount } from '@/src/database/repositories/transactions';
import { evaluateBudget } from '@/src/features/budgets/thresholds';
import { useDataStore } from '@/src/store/app-store';
import { colors } from '@/src/theme/tokens';
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
  const today = formatIsoDate(localDateFromDate(new Date()));

  const reload = useCallback(async () => {
    const db = getDatabase();
    const range = getComparisonRanges('month', localDateFromDate(new Date()));
    const [budget, categoryList, budgetList, monthSpent] = await Promise.all([
      getActiveBudget(db, null, today),
      listCategories(db),
      listBudgets(db),
      sumAmount(db, { type: 'expense', start: range.current.start, end: range.current.end }),
    ]);
    setAmount(budget?.amount ?? 0);
    setSpent(monthSpent);
    setCategories(categoryList.filter((category) => category.type !== 'income'));
    setBudgets(budgetList.filter((item) => item.categoryId));
  }, [today]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  async function saveOverall() {
    if (amount <= 0) {
      return;
    }
    await upsertMonthlyBudget(getDatabase(), { categoryId: null, amount, effectiveDate: `${today.slice(0, 8)}01` });
    bump();
    await reload();
  }

  async function saveCategory() {
    if (!categoryId || categoryAmount <= 0) {
      return;
    }
    await upsertMonthlyBudget(getDatabase(), { categoryId, amount: categoryAmount, effectiveDate: `${today.slice(0, 8)}01` });
    bump();
    setCategoryAmount(0);
    await reload();
  }

  const progress = evaluateBudget(spent, amount || null);

  return (
    <View style={styles.screen}>
      <StackHeader title="Ngân sách" />
      <ScrollView contentContainerStyle={styles.content}>
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
        <AppText variant="heading">Hạn mức cả tháng</AppText>
        <NumericKeypad amount={amount} onChange={setAmount} />
        <Button label="Lưu ngân sách" onPress={() => void saveOverall()} disabled={amount <= 0} />
        <AppText variant="heading">Theo hạng mục</AppText>
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
        <Button label="Lưu hạn mức hạng mục" variant="secondary" onPress={() => void saveCategory()} disabled={!categoryId || categoryAmount <= 0} />
        {budgets.map((budget) => {
          const category = categories.find((item) => item.id === budget.categoryId);
          return (
            <View key={budget.id} style={styles.budgetRow}>
              <AppText style={styles.flex}>{category?.name ?? 'Hạng mục'}</AppText>
              <AppText>{formatVnd(budget.amount)}</AppText>
              <Button
                label="Xóa"
                variant="ghost"
                onPress={() => {
                  void deleteBudget(getDatabase(), budget.id).then(() => reload());
                }}
              />
            </View>
          );
        })}
      </ScrollView>
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
});
