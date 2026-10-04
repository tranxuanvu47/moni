import { CATEGORY_KEYWORDS, OTHER_CATEGORY_ID } from '@/src/features/categories/defaults';
import type { Category, TransactionDraft, TransactionType } from '@/src/types/finance';
import {
  addDays,
  daysInMonth,
  formatIsoDate,
  localDateFromDate,
  type LocalDate,
} from '@/src/utils/dates';
import { createId } from '@/src/utils/id';
import { findAmount } from '@/src/utils/money';

const INCOME_NAMES = new Set(['Thu nhập']);

export function parseExpenseText(text: string, categories: Category[], now: Date): TransactionDraft[] {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return [];
  }

  const today = localDateFromDate(now);
  const leading = takeLeadingDate(trimmed, today);
  const clauses = splitClauses(leading.rest);

  return clauses.map((clause) => {
    const dated = takeEmbeddedDate(clause, today);
    const date = dated.date ?? leading.date ?? today;
    const amountMatch = findAmount(dated.rest);
    const withoutAmount = amountMatch
      ? `${dated.rest.slice(0, amountMatch.start)} ${dated.rest.slice(amountMatch.end)}`
      : dated.rest;
    const description = cleanupDescription(withoutAmount);
    const matched = matchCategory(description || clause, categories);
    const type: TransactionType = matched.name === 'Thu nhập' || INCOME_NAMES.has(matched.name) ? 'income' : 'expense';
    const category = categories.find((item) => item.name === matched.name) ?? categories.find((item) => item.id === OTHER_CATEGORY_ID);
    const needsAmount = !amountMatch || amountMatch.ambiguous || amountMatch.amount == null;
    const leftoverNumber = /\d{2,}/.test(description);
    const needsReview = needsAmount || leftoverNumber;
    const reviewReason = needsAmount
      ? 'Chưa thấy số tiền rõ ràng. Hãy nhập số tiền trước khi lưu.'
      : leftoverNumber
        ? 'Câu này còn số liệu. Hãy kiểm tra lại mô tả.'
        : undefined;

    return {
      id: createId(),
      type,
      amount: needsAmount ? null : amountMatch?.amount ?? null,
      currency: 'VND',
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? 'Khác',
      description: description || category?.name || 'Giao dịch',
      date: formatIsoDate(date),
      needsReview,
      reviewReason,
      categoryUncertain: matched.uncertain,
    };
  });
}

export function localParseIsComplete(drafts: TransactionDraft[]): boolean {
  return drafts.length > 0 && drafts.every((draft) => draft.amount != null && !draft.needsReview);
}

function splitClauses(text: string): string[] {
  const primary = text
    .split(/\s*(?:,|;|\n|\+|\brồi\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return primary.flatMap((part) => splitConjunction(part));
}

function splitConjunction(part: string): string[] {
  const pieces = part.split(/\s+(?:và|với)\s+/i).map((piece) => piece.trim()).filter(Boolean);
  if (pieces.length <= 1) {
    return pieces;
  }
  if (pieces.every((piece) => /\d/.test(piece))) {
    return pieces;
  }
  return [part];
}

function takeLeadingDate(text: string, today: LocalDate): { rest: string; date: LocalDate | null } {
  const found = findDate(text, today);
  if (!found || found.index !== 0) {
    return { rest: text, date: null };
  }
  return {
    rest: `${text.slice(0, found.index)}${text.slice(found.end)}`.replace(/\s+/g, ' ').trim(),
    date: found.date,
  };
}

function takeEmbeddedDate(text: string, today: LocalDate): { rest: string; date: LocalDate | null } {
  const found = findDate(text, today);
  if (!found) {
    return { rest: text, date: null };
  }
  return {
    rest: `${text.slice(0, found.index)} ${text.slice(found.end)}`.replace(/\s+/g, ' ').trim(),
    date: found.date,
  };
}

function findDate(text: string, today: LocalDate): { date: LocalDate; index: number; end: number } | null {
  const rules: { pattern: RegExp; resolve: (match: RegExpMatchArray) => LocalDate | null }[] = [
    { pattern: /\bhôm nay\b/i, resolve: () => today },
    { pattern: /\bhôm qua\b/i, resolve: () => addDays(today, -1) },
    { pattern: /\bhôm kia\b/i, resolve: () => addDays(today, -2) },
    { pattern: /\bhôm trước\b/i, resolve: () => addDays(today, -1) },
    {
      pattern: /\bngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?\b/i,
      resolve: (match) => buildDate(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : today.year),
    },
    {
      pattern: /\b(?:ngày\s+)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/i,
      resolve: (match) => {
        const year = match[3] ? normalizeYear(Number(match[3])) : today.year;
        return buildDate(Number(match[1]), Number(match[2]), year);
      },
    },
  ];

  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (!match || match.index === undefined) {
      continue;
    }
    const date = rule.resolve(match);
    if (!date) {
      continue;
    }
    return { date, index: match.index, end: match.index + match[0].length };
  }

  return null;
}

function buildDate(day: number, month: number, year: number): LocalDate | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

function normalizeYear(year: number): number {
  if (year < 100) {
    return 2000 + year;
  }
  return year;
}

function matchCategory(text: string, categories: Category[]): { name: string; uncertain: boolean } {
  const folded = text.toLocaleLowerCase('vi');
  const custom = categories
    .filter((category) => !category.isDefault && category.name.trim().length >= 2)
    .sort((left, right) => right.name.length - left.name.length);
  const customHit = custom.find((category) => folded.includes(category.name.toLocaleLowerCase('vi')));
  if (customHit) {
    return { name: customHit.name, uncertain: false };
  }

  for (const rule of CATEGORY_KEYWORDS) {
    const keyword = [...rule.keywords].sort((left, right) => right.length - left.length).find((item) => folded.includes(item));
    if (keyword) {
      return { name: rule.name, uncertain: false };
    }
  }

  return { name: 'Khác', uncertain: true };
}

function cleanupDescription(value: string): string {
  const cleaned = value
    .replace(/\b(hết|khoảng|tầm|mất|với giá|giá)\b/gi, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return '';
  }
  return cleaned.charAt(0).toLocaleUpperCase('vi') + cleaned.slice(1);
}
