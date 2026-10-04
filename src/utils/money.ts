const MAX_AMOUNT = 10_000_000_000;

const SCALE: Record<string, number> = {
  k: 1_000,
  nghìn: 1_000,
  nghin: 1_000,
  ngàn: 1_000,
  ngan: 1_000,
  triệu: 1_000_000,
  trieu: 1_000_000,
  tr: 1_000_000,
  đ: 1,
  '₫': 1,
  đồng: 1,
  dong: 1,
  vnd: 1,
};

const AMOUNT_PATTERN =
  /(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+|\d+(?:[.,]\d+)?)(?:\s*)(triệu|trieu|nghìn|nghin|ngàn|ngan|đồng|dong|vnd|tr|k|đ|₫)?(?![\p{L}])/giu;

export interface AmountMatch {
  amount: number | null;
  ambiguous: boolean;
  start: number;
  end: number;
  raw: string;
}

export function formatVnd(amount: number): string {
  const negative = amount < 0;
  const absolute = Math.abs(Math.trunc(amount));
  const formatted = absolute.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${formatted} ₫`;
}

export function formatTransactionAmount(type: 'expense' | 'income', amount: number): string {
  const formatted = formatVnd(amount);
  return type === 'expense' ? `−${formatted}` : `+${formatted}`;
}

export function formatCompactVnd(amount: number): string {
  const negative = amount < 0;
  const absolute = Math.abs(Math.trunc(amount));
  const sign = negative ? '-' : '';

  if (absolute >= 1_000_000) {
    return `${sign}${trimCompact(absolute / 1_000_000)} triệu`;
  }

  if (absolute >= 1_000) {
    return `${sign}${trimCompact(absolute / 1_000)}k`;
  }

  return `${sign}${absolute}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function findAmount(text: string): AmountMatch | null {
  const flags = AMOUNT_PATTERN.flags.includes('g') ? AMOUNT_PATTERN.flags : `${AMOUNT_PATTERN.flags}g`;
  const pattern = new RegExp(AMOUNT_PATTERN.source, flags);
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;

  while ((match = pattern.exec(text)) !== null) {
    last = match;
    if (match.index === pattern.lastIndex) {
      pattern.lastIndex += 1;
    }
  }

  if (!last || last.index === undefined) {
    return null;
  }

  const rawNumber = last[1] ?? '';
  const unit = (last[2] ?? '').toLocaleLowerCase('vi');
  const parsed = interpretAmount(rawNumber, unit || null);

  return {
    amount: parsed.amount,
    ambiguous: parsed.ambiguous,
    start: last.index,
    end: last.index + last[0].length,
    raw: last[0],
  };
}

function interpretAmount(rawNumber: string, unit: string | null): { amount: number | null; ambiguous: boolean } {
  const scale = unit ? SCALE[unit] : null;
  const hasScale = scale != null && scale > 1;
  const thousandDots = /^\d{1,3}(?:\.\d{3})+$/.test(rawNumber);
  const thousandCommas = /^\d{1,3}(?:,\d{3})+$/.test(rawNumber);

  let numeric: number;
  if ((thousandDots || thousandCommas) && !hasScale) {
    numeric = Number(rawNumber.replace(/[.,]/g, ''));
  } else if (thousandDots || thousandCommas) {
    numeric = Number(rawNumber.replace(/[.,]/g, ''));
  } else {
    numeric = Number(rawNumber.replace(',', '.'));
  }

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { amount: null, ambiguous: true };
  }

  if (!unit && numeric < 1000 && !thousandDots && !thousandCommas) {
    return { amount: null, ambiguous: true };
  }

  const multiplier = scale ?? 1;
  const amount = Math.round(numeric * multiplier);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { amount: null, ambiguous: true };
  }

  return { amount, ambiguous: false };
}

function trimCompact(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
  return text;
}
