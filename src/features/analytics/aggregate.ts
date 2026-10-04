import { daysBetween, eachDate, formatIsoDate, monthLabels, parseIsoDate, weekdayLabels, type PeriodKind } from '@/src/utils/dates';

export interface ChartPoint {
  label: string;
  value: number;
}

export interface CategorySlice {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  total: number;
  share: number;
}

export function fillDailySeries(start: string, end: string, buckets: { day: string; total: number }[]): ChartPoint[] {
  const totals = new Map(buckets.map((bucket) => [bucket.day, bucket.total]));
  return eachDate(start, end).map((day) => ({
    label: String(Number(day.slice(8, 10))),
    value: totals.get(day) ?? 0,
  }));
}

export function fillWeekSeries(start: string, buckets: { day: string; total: number }[]): ChartPoint[] {
  const labels = weekdayLabels();
  const totals = new Map(buckets.map((bucket) => [bucket.day, bucket.total]));
  const origin = parseIsoDate(start);
  return labels.map((label, index) => {
    const date = new Date(origin.year, origin.month - 1, origin.day + index);
    const iso = formatIsoDate({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
    return { label, value: totals.get(iso) ?? 0 };
  });
}

export function fillHourSeries(buckets: { hour: string; total: number }[]): ChartPoint[] {
  const totals = new Map(buckets.map((bucket) => [bucket.hour, bucket.total]));
  return Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, '0');
    return {
      label: hour % 4 === 0 ? String(hour) : '',
      value: totals.get(key) ?? 0,
    };
  });
}

export function fillMonthSeries(buckets: { month: string; total: number }[]): ChartPoint[] {
  const totals = new Map(buckets.map((bucket) => [bucket.month, bucket.total]));
  return monthLabels().map((label, index) => ({
    label,
    value: totals.get(String(index + 1).padStart(2, '0')) ?? 0,
  }));
}

export function toCategorySlices(
  rows: { categoryId: string; name: string; color: string; icon: string; total: number }[],
): CategorySlice[] {
  const sum = rows.reduce((total, row) => total + row.total, 0);
  return rows.map((row) => ({
    ...row,
    share: sum === 0 ? 0 : row.total / sum,
  }));
}

export function averagePerElapsedDay(total: number, start: string, end: string): number {
  const elapsed = daysBetween(parseIsoDate(start), parseIsoDate(end)) + 1;
  if (elapsed <= 0) {
    return 0;
  }
  return Math.round(total / elapsed);
}

export function periodChartKind(kind: PeriodKind): 'hour' | 'week' | 'day' | 'month' {
  if (kind === 'day') {
    return 'hour';
  }
  if (kind === 'week') {
    return 'week';
  }
  if (kind === 'year') {
    return 'month';
  }
  return 'day';
}

export interface ChangeSummary {
  text: string;
  direction: 'up' | 'down' | 'flat' | 'na';
}

export function describeChange(current: number, previous: number): ChangeSummary {
  if (previous <= 0) {
    return { text: 'Chưa đủ dữ liệu cùng kỳ để so sánh', direction: 'na' };
  }
  const delta = (current - previous) / previous;
  const percent = Math.round(Math.abs(delta) * 100);
  if (percent === 0) {
    return { text: 'Ngang cùng kỳ trước', direction: 'flat' };
  }
  if (delta > 0) {
    return { text: `Cao hơn ${percent}% so với cùng kỳ`, direction: 'up' };
  }
  return { text: `Thấp hơn ${percent}% so với cùng kỳ`, direction: 'down' };
}
