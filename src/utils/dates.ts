export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

export interface DateRange {
  start: string;
  end: string;
}

export function localDateFromDate(date: Date): LocalDate {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export function formatIsoDate(date: LocalDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export function parseIsoDate(value: string): LocalDate {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const next = new Date(date.year, date.month - 1, date.day + days);
  return localDateFromDate(next);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function compareDates(left: LocalDate, right: LocalDate): number {
  return formatIsoDate(left).localeCompare(formatIsoDate(right));
}

export function startOfWeek(date: LocalDate): LocalDate {
  const native = new Date(date.year, date.month - 1, date.day);
  const weekday = native.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return addDays(date, diff);
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const target = new Date(date.year, date.month - 1 + months, 1);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  const day = Math.min(date.day, daysInMonth(year, month));
  return { year, month, day };
}

export function clampDay(year: number, month: number, day: number): LocalDate {
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
}

export function toLocalDateTime(date: Date): string {
  return `${formatIsoDate(localDateFromDate(date))}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function combineDateAndTime(date: string, timeSource: Date): string {
  return `${date}T${pad(timeSource.getHours())}:${pad(timeSource.getMinutes())}:${pad(timeSource.getSeconds())}`;
}

export function formatMonthLabel(date: LocalDate): string {
  return `Tháng ${date.month}, ${date.year}`;
}

export function formatDayLabel(date: LocalDate, today: LocalDate): string {
  const iso = formatIsoDate(date);
  if (iso === formatIsoDate(today)) {
    return 'Hôm nay';
  }
  if (iso === formatIsoDate(addDays(today, -1))) {
    return 'Hôm qua';
  }
  return `${date.day} tháng ${date.month}`;
}

export function formatTime(localDateTime: string): string {
  return localDateTime.slice(11, 16);
}

export function nextIsoDate(isoDate: string): string {
  return formatIsoDate(addDays(parseIsoDate(isoDate), 1));
}

export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = parseIsoDate(start);
  const last = formatIsoDate(parseIsoDate(end));
  while (formatIsoDate(cursor) <= last) {
    dates.push(formatIsoDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export interface ComparisonRanges {
  current: DateRange;
  previous: DateRange;
  label: string;
}

export function getComparisonRanges(kind: PeriodKind, today: LocalDate): ComparisonRanges {
  if (kind === 'day') {
    const current = formatIsoDate(today);
    const previous = formatIsoDate(addDays(today, -1));
    return {
      current: { start: current, end: current },
      previous: { start: previous, end: previous },
      label: formatDayLabel(today, today),
    };
  }

  if (kind === 'week') {
    const weekStart = startOfWeek(today);
    const elapsed = daysBetween(weekStart, today);
    const previousStart = addDays(weekStart, -7);
    const previousEnd = addDays(previousStart, elapsed);
    return {
      current: { start: formatIsoDate(weekStart), end: formatIsoDate(today) },
      previous: { start: formatIsoDate(previousStart), end: formatIsoDate(previousEnd) },
      label: `Tuần ${formatIsoDate(weekStart).slice(8, 10)}/${weekStart.month}`,
    };
  }

  if (kind === 'month') {
    const start = { year: today.year, month: today.month, day: 1 };
    const previousAnchor = addMonths(today, -1);
    const previousStart = { year: previousAnchor.year, month: previousAnchor.month, day: 1 };
    const previousEnd = clampDay(previousAnchor.year, previousAnchor.month, today.day);
    return {
      current: { start: formatIsoDate(start), end: formatIsoDate(today) },
      previous: { start: formatIsoDate(previousStart), end: formatIsoDate(previousEnd) },
      label: formatMonthLabel(today),
    };
  }

  const start = { year: today.year, month: 1, day: 1 };
  const previousEnd = clampDay(today.year - 1, today.month, today.day);
  return {
    current: { start: formatIsoDate(start), end: formatIsoDate(today) },
    previous: { start: formatIsoDate({ year: today.year - 1, month: 1, day: 1 }), end: formatIsoDate(previousEnd) },
    label: `Năm ${today.year}`,
  };
}

export function daysBetween(start: LocalDate, end: LocalDate): number {
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endUtc - startUtc) / 86_400_000);
}

export function weekdayLabels(): string[] {
  return ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
}

export function monthLabels(): string[] {
  return ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
