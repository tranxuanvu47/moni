import type { DatabaseClient } from '@/src/database/client';
import { getActiveBudget } from '@/src/database/repositories/budgets';
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
  series: ChartPoint[];
  highlightIndex: number;
  categories: CategorySlice[];
  recent: TransactionListItem[];
  insight: string;
  transactionCount: number;
}

export async function loadDashboard(db: DatabaseClient, now = new Date()): Promise<DashboardModel> {
  const today = localDateFromDate(now);
  const todayIso = formatIsoDate(today);
  const ranges = getComparisonRanges('month', today);
  const monthEnd = formatIsoDate({ year: today.year, month: today.month, day: daysInMonth(today.year, today.month) });
  const [expenseTotal, previousExpense, incomeTotal, budget, days, categoryRows, recent, transactionCount] = await Promise.all([
    sumAmount(db, { type: 'expense', start: ranges.current.start, end: ranges.current.end }),
    sumAmount(db, { type: 'expense', start: ranges.previous.start, end: ranges.previous.end }),
    sumAmount(db, { type: 'income', start: ranges.current.start, end: ranges.current.end }),
    getActiveBudget(db, null, todayIso),
    sumByDay(db, { type: 'expense', start: ranges.current.start.slice(0, 8) + '01', end: monthEnd }),
    sumByCategory(db, { type: 'expense', start: ranges.current.start, end: ranges.current.end }),
    listTransactions(db, { limit: 5, offset: 0 }),
    countTransactions(db, { type: 'expense', start: ranges.current.start, end: ranges.current.end }),
  ]);
  const slices = toCategorySlices(categoryRows);
  const change = describeChange(expenseTotal, previousExpense);
  const progress = evaluateBudget(expenseTotal, budget?.amount ?? null);

  return {
    label: formatMonthLabel(today),
    expenseTotal,
    incomeTotal,
    changeText: change.text,
    previousExpense,
    budget: { ...progress, amount: budget?.amount ?? null },
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
