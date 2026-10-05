import type { DatabaseClient } from '@/src/database/client';
import { getActiveBudget, listBudgets } from '@/src/database/repositories/budgets';
import { listCategories } from '@/src/database/repositories/categories';
import { countTransactions, listTransactions, sumAmount, sumByCategory, sumByDay } from '@/src/database/repositories/transactions';
import { describeChange, fillDailySeries, toCategorySlices, type CategorySlice, type ChartPoint } from '@/src/features/analytics/aggregate';
import { buildLocalInsight } from '@/src/features/analytics/insights';
import { evaluateBudget, type BudgetProgress } from '@/src/features/budgets/thresholds';
import type { TransactionListItem } from '@/src/types/finance';
import { daysInMonth, formatIsoDate, formatMonthLabel, getComparisonRanges, localDateFromDate } from '@/src/utils/dates';

export interface DashboardModel {
  label: string;
  expenseTotal: number;
  incomeTotal: number;
  changeText: string;
  previousExpense: number;
  budget: BudgetProgress & { amount: number | null };
  budgetJars: BudgetJarProgress[];
  series: ChartPoint[];
  highlightIndex: number;
  categories: CategorySlice[];
  recent: TransactionListItem[];
  insight: string;
  transactionCount: number;
}

export interface BudgetJarProgress extends BudgetProgress {
  categoryId: string;
  name: string;
  amount: number;
  warningThresholdPercent: number;
  limitThresholdPercent: number;
}

export async function loadDashboard(db: DatabaseClient, now = new Date()): Promise<DashboardModel> {
  const today = localDateFromDate(now);
  const todayIso = formatIsoDate(today);
  const ranges = getComparisonRanges('month', today);
  const monthEnd = formatIsoDate({ year: today.year, month: today.month, day: daysInMonth(today.year, today.month) });
  const [expenseTotal, previousExpense, incomeTotal, budget, days, categoryRows, recent, transactionCount, budgetHistory, categoryList] = await Promise.all([
    sumAmount(db, { type: 'expense', start: ranges.current.start, end: ranges.current.end }),
    sumAmount(db, { type: 'expense', start: ranges.previous.start, end: ranges.previous.end }),
    sumAmount(db, { type: 'income', start: ranges.current.start, end: ranges.current.end }),
    getActiveBudget(db, null, todayIso),
    sumByDay(db, { type: 'expense', start: ranges.current.start.slice(0, 8) + '01', end: monthEnd }),
    sumByCategory(db, { type: 'expense', start: ranges.current.start, end: ranges.current.end }),
    listTransactions(db, { limit: 5, offset: 0 }),
    countTransactions(db, { type: 'expense', start: ranges.current.start, end: ranges.current.end }),
    listBudgets(db),
    listCategories(db),
  ]);
  const slices = toCategorySlices(categoryRows);
  const spentByCategory = new Map(slices.map((slice) => [slice.categoryId, slice.total]));
  const categoryNameById = new Map(categoryList.map((category) => [category.id, category.name]));
  const activeCategoryBudgetIds = new Set<string>();
  const budgetJars = budgetHistory
    .filter((item) => item.categoryId != null && item.effectiveDate <= todayIso)
    .filter((item) => {
      if (!item.categoryId || activeCategoryBudgetIds.has(item.categoryId)) return false;
      activeCategoryBudgetIds.add(item.categoryId);
      return true;
    })
    .map((item) => {
      const spent = spentByCategory.get(item.categoryId ?? '') ?? 0;
      const progress = evaluateBudget(spent, item.amount, item.warningThresholdBps / 10000, item.limitThresholdBps / 10000);
      return {
        ...progress,
        categoryId: item.categoryId ?? '',
        name: categoryNameById.get(item.categoryId ?? '') ?? 'Hạng mục',
        amount: item.amount,
        warningThresholdPercent: item.warningThresholdBps / 100,
        limitThresholdPercent: item.limitThresholdBps / 100,
      };
    })
    .sort((left, right) => right.ratio - left.ratio);
  const change = describeChange(expenseTotal, previousExpense);
  const progress = evaluateBudget(expenseTotal, budget?.amount ?? null);

  return {
    label: formatMonthLabel(today),
    expenseTotal,
    incomeTotal,
    changeText: change.text,
    previousExpense,
    budget: { ...progress, amount: budget?.amount ?? null },
    budgetJars,
    series: fillDailySeries(`${todayIso.slice(0, 8)}01`, monthEnd, days),
    highlightIndex: today.day - 1,
    categories: slices.slice(0, 4),
    recent,
    transactionCount,
    insight: buildLocalInsight({
      expenseTotal,
      transactionCount,
      topCategoryName: slices[0]?.name,
      topCategoryShare: slices[0]?.share,
      budgetAmount: budget?.amount,
      budgetSpent: expenseTotal,
      changeText: change.text,
      changeDirection: change.direction,
    }),
  };
}
