export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringRuleSchedule {
  id: string;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: string;
  endDate?: string | null;
}

export interface OccurrenceRange {
  startDate: string;
  endDate: string;
}

export interface RecurringOccurrence {
  key: string;
  ruleId: string;
  date: string;
  sequence: number;
}

const MAX_RETURNED_OCCURRENCES = 10_000;

/** Generates inclusive, date-only occurrences. It never converts through the device timezone. */
export function generateRecurringOccurrences(
  rule: RecurringRuleSchedule,
  range: OccurrenceRange,
  maxOccurrences = MAX_RETURNED_OCCURRENCES,
): RecurringOccurrence[] {
  const start = parseLocalDate(rule.startDate);
  const rangeStart = parseLocalDate(range.startDate);
  const rangeEnd = parseLocalDate(range.endDate);
  const end = rule.endDate ? parseLocalDate(rule.endDate) : null;
  validateRule(rule, start, end, rangeStart, rangeEnd, maxOccurrences);

  const lastDate = end && compareDate(end, rangeEnd) < 0 ? end : rangeEnd;
  if (compareDate(start, lastDate) > 0) {
    return [];
  }

  let sequence = firstSequenceOnOrBefore(rule, start, rangeStart);
  let date = occurrenceAt(rule, start, sequence);
  while (compareDate(date, rangeStart) < 0) {
    sequence += 1;
    date = occurrenceAt(rule, start, sequence);
  }

  const result: RecurringOccurrence[] = [];
  while (compareDate(date, lastDate) <= 0) {
    result.push({ key: recurringOccurrenceKey(rule.id, formatLocalDate(date)), ruleId: rule.id, date: formatLocalDate(date), sequence });
    if (result.length > maxOccurrences) {
      throw new Error('Occurrence range is too large.');
    }
    sequence += 1;
    date = occurrenceAt(rule, start, sequence);
  }
  return result;
}

export function recurringOccurrenceKey(ruleId: string, date: string): string {
  const cleanRuleId = ruleId.trim();
  if (!cleanRuleId) {
    throw new Error('ruleId is required.');
  }
  parseLocalDate(date);
  return `recurring:${cleanRuleId}:${date}`;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

function validateRule(
  rule: RecurringRuleSchedule,
  start: LocalDate,
  end: LocalDate | null,
  rangeStart: LocalDate,
  rangeEnd: LocalDate,
  maxOccurrences: number,
): void {
  if (!rule.id.trim()) {
    throw new Error('rule.id is required.');
  }
  if (!Number.isSafeInteger(rule.interval) || rule.interval < 1) {
    throw new Error('interval must be a positive integer.');
  }
  if (!Number.isSafeInteger(maxOccurrences) || maxOccurrences < 1) {
    throw new Error('maxOccurrences must be a positive integer.');
  }
  if (end && compareDate(end, start) < 0) {
    throw new Error('endDate cannot be before startDate.');
  }
  if (compareDate(rangeEnd, rangeStart) < 0) {
    throw new Error('range.endDate cannot be before range.startDate.');
  }
}

function firstSequenceOnOrBefore(rule: RecurringRuleSchedule, start: LocalDate, target: LocalDate): number {
  if (compareDate(target, start) <= 0) {
    return 0;
  }
  switch (rule.frequency) {
    case 'daily':
      return Math.max(0, Math.floor(daysBetween(start, target) / rule.interval));
    case 'weekly':
      return Math.max(0, Math.floor(daysBetween(start, target) / (7 * rule.interval)));
    case 'monthly': {
      const months = (target.year - start.year) * 12 + target.month - start.month;
      return Math.max(0, Math.floor(months / rule.interval));
    }
    case 'yearly':
      return Math.max(0, Math.floor((target.year - start.year) / rule.interval));
  }
}

function occurrenceAt(rule: RecurringRuleSchedule, start: LocalDate, sequence: number): LocalDate {
  const steps = sequence * rule.interval;
  switch (rule.frequency) {
    case 'daily':
      return addDays(start, steps);
    case 'weekly':
      return addDays(start, steps * 7);
    case 'monthly':
      return addMonthsClamped(start, steps);
    case 'yearly':
      return addYearsClamped(start, steps);
  }
}

function addDays(date: LocalDate, days: number): LocalDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function addMonthsClamped(anchor: LocalDate, months: number): LocalDate {
  const absoluteMonth = anchor.year * 12 + anchor.month - 1 + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth - year * 12 + 1;
  return { year, month, day: Math.min(anchor.day, daysInMonth(year, month)) };
}

function addYearsClamped(anchor: LocalDate, years: number): LocalDate {
  const year = anchor.year + years;
  return { year, month: anchor.month, day: Math.min(anchor.day, daysInMonth(year, anchor.month)) };
}

function daysBetween(left: LocalDate, right: LocalDate): number {
  const leftMs = Date.UTC(left.year, left.month - 1, left.day);
  const rightMs = Date.UTC(right.year, right.month - 1, right.day);
  return Math.floor((rightMs - leftMs) / 86_400_000);
}

function parseLocalDate(value: string): LocalDate {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid local date: ${value}`);
  }
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (result.year < 1 || result.month < 1 || result.month > 12 || result.day < 1 || result.day > daysInMonth(result.year, result.month)) {
    throw new Error(`Invalid local date: ${value}`);
  }
  return result;
}

function formatLocalDate(date: LocalDate): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}`;
}

function compareDate(left: LocalDate, right: LocalDate): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
