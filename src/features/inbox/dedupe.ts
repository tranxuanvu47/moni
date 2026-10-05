export type InboxSource = 'bank_notification' | 'ai_text' | 'voice' | 'statement_import';

export type MoneyDirection = 'expense' | 'income';

export interface CanonicalFingerprintInput {
  source: InboxSource;
  /** Package name, importer ID, parser session, or another source-specific namespace. */
  sourceNamespace: string;
  /** Stable, non-recyclable ID supplied by the source, such as a provider event or import row ID. */
  sourceEventId?: string | null;
  /** Transaction reference supplied by a bank or statement, when available. */
  externalTransactionId?: string | null;
  type: MoneyDirection;
  amount: number;
  currency?: string;
  occurredLocalDate?: string | null;
  merchant?: string | null;
  description?: string | null;
  rawText?: string | null;
}

export interface DedupeResult<T> {
  unique: T[];
  duplicates: { duplicate: T; original: T }[];
}

export interface TransferPairCandidate {
  id: string;
  type: MoneyDirection;
  amount: number;
  currency: string;
  accountId: string | null;
  occurredAt: string;
  transferReference?: string | null;
  counterparty?: string | null;
}

export interface PotentialInternalTransferPair {
  outgoingId: string;
  incomingId: string;
  confidence: 'potential';
  evidence: ('equal_amount' | 'distinct_accounts' | 'time_window' | 'reference_match' | 'counterparty_match')[];
  timeDifferenceMs: number;
}

const DEFAULT_TRANSFER_WINDOW_MS = 15 * 60 * 1000;

/**
 * Creates a source-scoped fingerprint without retaining the input text. Stable source
 * identifiers win over content so an updated event does not create a second draft. The
 * non-cryptographic hash is for deduplication, not privacy, security, or authentication.
 */
export function canonicalSourceFingerprint(input: CanonicalFingerprintInput): string {
  const namespace = normalizeIdentifier(input.sourceNamespace);
  if (!namespace) {
    throw new Error('sourceNamespace is required.');
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error('amount must be a positive safe integer.');
  }

  const externalId = normalizeIdentifier(input.externalTransactionId);
  const eventId = normalizeIdentifier(input.sourceEventId);
  let identity: readonly unknown[];
  if (externalId) {
    identity = ['external', externalId];
  } else if (eventId) {
    identity = ['event', eventId];
  } else {
    const localDate = normalizeLocalDate(input.occurredLocalDate);
    const merchant = normalizeCanonicalText(input.merchant);
    const content = normalizeCanonicalText(input.description) || normalizeCanonicalText(input.rawText);
    if (!localDate || (!merchant && !content)) {
      throw new Error('A stable source ID or a local date plus merchant/content is required.');
    }
    identity = ['content', input.type, input.amount, normalizeCurrency(input.currency), localDate, merchant, content];
  }

  const canonical = JSON.stringify([input.source, namespace, ...identity]);
  return `fp_${input.source}_${hash128(canonical)}`;
}

export function dedupeByFingerprint<T>(items: readonly T[], getFingerprint: (item: T) => string): DedupeResult<T> {
  const firstByFingerprint = new Map<string, T>();
  const unique: T[] = [];
  const duplicates: { duplicate: T; original: T }[] = [];

  for (const item of items) {
    const fingerprint = getFingerprint(item);
    const original = firstByFingerprint.get(fingerprint);
    if (original) {
      duplicates.push({ duplicate: item, original });
      continue;
    }
    firstByFingerprint.set(fingerprint, item);
    unique.push(item);
  }

  return { unique, duplicates };
}

/**
 * Produces a review suggestion only. Equal amounts and close timestamps are never enough:
 * both known, distinct accounts and a matching reference/counterparty are required.
 */
export function detectPotentialInternalTransferPair(
  left: TransferPairCandidate,
  right: TransferPairCandidate,
  windowMs = DEFAULT_TRANSFER_WINDOW_MS,
): PotentialInternalTransferPair | null {
  if (left.id === right.id || left.type === right.type || left.amount !== right.amount || left.currency !== right.currency) {
    return null;
  }
  if (!left.accountId || !right.accountId || left.accountId === right.accountId) {
    return null;
  }

  const leftTime = comparableTime(left.occurredAt);
  const rightTime = comparableTime(right.occurredAt);
  if (leftTime == null || rightTime == null || !Number.isFinite(windowMs) || windowMs < 0) {
    return null;
  }
  const timeDifferenceMs = Math.abs(leftTime - rightTime);
  if (timeDifferenceMs > windowMs) {
    return null;
  }

  const referenceMatch = sameStrongSignal(left.transferReference, right.transferReference);
  const counterpartyMatch = sameStrongSignal(left.counterparty, right.counterparty);
  if (!referenceMatch && !counterpartyMatch) {
    return null;
  }

  const outgoing = left.type === 'expense' ? left : right;
  const incoming = left.type === 'income' ? left : right;
  return {
    outgoingId: outgoing.id,
    incomingId: incoming.id,
    confidence: 'potential',
    evidence: [
      'equal_amount',
      'distinct_accounts',
      'time_window',
      ...(referenceMatch ? (['reference_match'] as const) : []),
      ...(counterpartyMatch ? (['counterparty_match'] as const) : []),
    ],
    timeDifferenceMs,
  };
}

export function normalizeCanonicalText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLocaleLowerCase('vi')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIdentifier(value: string | null | undefined): string {
  return normalizeCanonicalText(value).replace(/\s/g, '');
}

function normalizeCurrency(value: string | undefined): string {
  return (value ?? 'VND').trim().toUpperCase();
}

function normalizeLocalDate(value: string | null | undefined): string {
  const normalized = value?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function sameStrongSignal(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeCanonicalText(left).replace(/[^\p{L}\p{N}]+/gu, '');
  const b = normalizeCanonicalText(right).replace(/[^\p{L}\p{N}]+/gu, '');
  return a.length >= 4 && a === b;
}

function comparableTime(value: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second = '0'] = match;
  const parsed = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isFinite(parsed) ? parsed : null;
}

function hash128(value: string): string {
  const state = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    for (let lane = 0; lane < state.length; lane += 1) {
      const current = state[lane] ?? 0;
      state[lane] = Math.imul(current ^ (code + lane * 131), 0x01000193) >>> 0;
    }
  }
  return state.map((part) => part.toString(16).padStart(8, '0')).join('');
}
