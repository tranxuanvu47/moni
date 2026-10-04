import type { DatabaseClient } from '@/src/database/client';
import { countTransactions, sumAmount, sumByCategory, sumByDay, sumByHour, sumByMonth } from '@/src/database/repositories/transactions';
import {
  averagePerElapsedDay,
  describeChange,
  fillDailySeries,
  fillHourSeries,
  fillMonthSeries,
  fillWeekSeries,
  toCategorySlices,
  type CategorySlice,
  type ChartPoint,
} from '@/src/features/analytics/aggregate';
import type { PeriodKind } from '@/src/types/finance';
import { daysInMonth, formatIsoDate, getComparisonRanges, localDateFromDate, startOfWeek } from '@/src/utils/dates';

export interface AnalyticsModel {
  label: string;
  expenseTotal: number;
  incomeTotal: number;
  previousExpense: number;
  changeText: string;
  average: number;
  count: number;
  slices: CategorySlice[];
  series: ChartPoint[];
  chart: 'bar' | 'line';
}

export async function loadAnalytics(db: DatabaseClient, kind: PeriodKind, now = new Date()): Promise<AnalyticsModel> {
  const today = localDateFromDate(now);
  const ranges = getComparisonRanges(kind, today);
  const [expenseTotal, previousExpense, incomeTotal, count, categoryRows] = await Promise.all([
    sumAmount(db, { type: 'expense', start: ranges.current.start, end: ranges.current.end }),
    sumAmount(db, { type: 'expense', start: ranges.previous.start, end: ranges.previous.end }),
    sumAmount(db, { type: 'income', start: ranges.current.start, end: ranges.current.end }),
    countTransactions(db, { type: 'expense', start: ranges.current.start, end: ranges.current.end }),
    sumByCategory(db, { type: 'expense', start: ranges.current.start, end: ranges.current.end }),
  ]);

  let series: ChartPoint[] = [];
  let chart: 'bar' | 'line' = 'bar';
  if (kind === 'day') {
    series = fillHourSeries(await sumByHour(db, { type: 'expense', day: ranges.current.start }));
  } else if (kind === 'week') {
    const weekStart = formatIsoDate(startOfWeek(today));
    series = fillWeekSeries(weekStart, await sumByDay(db, { type: 'expense', start: weekStart, end: formatIsoDate(today) }));
  } else if (kind === 'month') {
    const start = `${formatIsoDate(today).slice(0, 8)}01`;
    const end = formatIsoDate({ year: today.year, month: today.month, day: daysInMonth(today.year, today.month) });
    series = fillDailySeries(start, end, await sumByDay(db, { type: 'expense', start, end }));
  } else {
    chart = 'line';
    series = fillMonthSeries(await sumByMonth(db, { type: 'expense', year: today.year }));
  }

  return {
    label: ranges.label,
    expenseTotal,
    incomeTotal,
    previousExpense,
    changeText: describeChange(expenseTotal, previousExpense).text,
    average: averagePerElapsedDay(expenseTotal, ranges.current.start, ranges.current.end),
    count,
    slices: toCategorySlices(categoryRows).slice(0, 6),
    series,
    chart,
  };
}
