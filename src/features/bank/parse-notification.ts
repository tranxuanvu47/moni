import { INCOME_CATEGORY_ID, OTHER_CATEGORY_ID } from '@/src/features/categories/defaults';
import { BANK_PACKAGE_LABELS } from '@/src/features/bank/packages';
import { findAmount, formatVnd } from '@/src/utils/money';

export interface BankNotificationLike {
  packageName: string;
  title?: string | null;
  text?: string | null;
  bigText?: string | null;
  subText?: string | null;
  summaryText?: string | null;
  postTime?: number | null;
  key?: string | null;
  appName?: string | null;
}

export interface ParsedBankTransaction {
  type: 'expense' | 'income';
  amount: number;
  categoryId: string;
  description: string;
  occurredAtMs: number;
  fingerprint: string;
  bankLabel: string;
  rawBody: string;
  signedFromAmount: boolean;
}

const INCOME_HINT =
  /\b(nhận|nhan|cộng|cong|credit|nạp|nap|hoàn|hoan|refund|lương|luong|thưởng|thuong|tiền vào|tien vao|nhận tiền|nhan tien)\b/i;
const EXPENSE_HINT =
  /\b(chi|thanh toán|thanh toan|debit|rút|rut|mua|qr|pos|ecom|trừ|tru|tiền ra|tien ra|chi tiêu|chi tieu)\b/i;
const OTP_HINT = /\b(otp|mã xác thực|ma xac thuc|verification code|đăng nhập|dang nhap|password)\b/i;
const MONEY_HINT =
  /\b(vnd|đ|₫|vnđ|so tien|số tiền|gd|giao dịch|giao dich|tk|tài khoản|tai khoan|balance|số dư|so du|ps:)\b/i;

const DESCRIPTION_MAX = 400;

export function parseBankNotification(input: BankNotificationLike): ParsedBankTransaction | null {
  const packageName = input.packageName?.trim() ?? '';
  if (!packageName) {
    return null;
  }

  const body = combineNotificationBody(input);
  if (!body || OTP_HINT.test(body)) {
    return null;
  }

  const looksFinancial = MONEY_HINT.test(body) || findAmount(body) != null || /\bPS:\s*[+-]?/i.test(body);
  if (!looksFinancial) {
    return null;
  }

  const amountMatch = findBankAmount(body);
  if (!amountMatch || amountMatch.amount <= 0) {
    return null;
  }

  const type = detectType(body, amountMatch.sign);
  const bankLabel = BANK_PACKAGE_LABELS[packageName] ?? (input.appName?.trim() || packageLabel(packageName));
  const description = buildDescription(body, bankLabel, type, amountMatch.amount);
  const occurredAtMs = typeof input.postTime === 'number' && input.postTime > 0 ? input.postTime : Date.now();
  const fingerprint = buildFingerprint(packageName, input.key ?? '', amountMatch.amount, body, occurredAtMs);

  return {
    type,
    amount: amountMatch.amount,
    categoryId: type === 'income' ? INCOME_CATEGORY_ID : OTHER_CATEGORY_ID,
    description,
    occurredAtMs,
    fingerprint,
    bankLabel,
    rawBody: body,
    signedFromAmount: amountMatch.sign != null,
  };
}

function combineNotificationBody(input: BankNotificationLike): string {
  // bigText thường đủ nội dung; text có thể bị Android cắt ngắn.
  const parts = [input.bigText, input.text, input.title, input.subText, input.summaryText]
    .map((part) => part?.replace(/\s+/g, ' ').trim())
    .filter((part): part is string => Boolean(part));

  const unique: string[] = [];
  for (const part of [...parts].sort((left, right) => right.length - left.length)) {
    const covered = unique.some((kept) => kept.includes(part));
    if (!covered) {
      unique.push(part);
    }
  }

  return unique.join(' ').replace(/\s+/g, ' ').trim();
}

function findBankAmount(text: string): { amount: number; sign: '+' | '-' | null } | null {
  // TPBank / nhiều NH VN: "PS: -1.000.000" hoặc "PS:+500.000"
  const ps = text.match(/\bPS:\s*([+-])\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d{4,})/i);
  if (ps?.[1] && ps[2]) {
    const amount = Number(ps[2].replace(/[.,]/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      return { amount, sign: ps[1] as '+' | '-' };
    }
  }

  const signed = text.match(
    /(?:(?:VND|VNĐ|₫|đ)\s*)?([+-])\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d{4,})(?:\s*(?:VND|VNĐ|₫|đ))?/i,
  );
  if (signed?.[1] && signed[2]) {
    const amount = Number(signed[2].replace(/[.,]/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      return { amount, sign: signed[1] as '+' | '-' };
    }
  }

  const withoutNoise = stripNonAmountNoise(text);
  const match = findAmount(withoutNoise) ?? findAmount(text);
  if (!match?.amount) {
    return null;
  }
  return { amount: match.amount, sign: null };
}

function stripNonAmountNoise(text: string): string {
  return text
    .replace(/\bTK:\s*\S+/gi, ' ')
    .replace(/\bSD(?:\s+KHA\s+DUNG)?:\s*[+-]?[\d.,]+/gi, ' ')
    .replace(/\bSO\s*GD:\s*\S+/gi, ' ')
    .replace(/\b(?:số dư|so du|available balance)\b[^.]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectType(text: string, sign: '+' | '-' | null): 'expense' | 'income' {
  // Ưu tiên hướng tiền từ số có dấu — không tạo loại "chuyển".
  if (sign === '+') {
    return 'income';
  }
  if (sign === '-') {
    return 'expense';
  }

  const income = INCOME_HINT.test(text);
  const expense = EXPENSE_HINT.test(text);
  if (income && !expense) {
    return 'income';
  }
  if (expense && !income) {
    return 'expense';
  }
  if (/\+\s*\d/.test(text)) {
    return 'income';
  }
  if (/-\s*\d/.test(text)) {
    return 'expense';
  }
  // "chuyen tien" không dấu: mặc định chi (tiền ra). Thu thường có + hoặc "nhận".
  return 'expense';
}

function buildDescription(body: string, bankLabel: string, type: 'expense' | 'income', amount: number): string {
  const money = `${type === 'income' ? '+' : '−'}${formatVnd(amount)}`;
  const nd = extractNoiDung(body);
  if (nd) {
    return clip(`${bankLabel} · ${money} · ${nd}`, DESCRIPTION_MAX);
  }

  const cleaned = stripNonAmountNoise(body)
    .replace(/(?:(?:VND|VNĐ|₫|đ)\s*)?[+-]?\s*\d{1,3}(?:[.,]\d{3})+(?:\s*(?:VND|VNĐ|₫|đ))?/gi, ' ')
    .replace(/\bPS:\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return `${bankLabel} · ${money}`;
  }
  return clip(`${bankLabel} · ${money} · ${cleaned}`, DESCRIPTION_MAX);
}

function extractNoiDung(body: string): string | null {
  const match = body.match(/\bND:\s*(.+?)(?:\s+SO\s*GD:|\s+SD:|$)/i);
  const value = match?.[1]?.replace(/\s+/g, ' ').trim();
  return value || null;
}

function clip(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function buildFingerprint(packageName: string, key: string, amount: number, body: string, postTime: number): string {
  const normalized = body.toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
  const seed = `${packageName}|${key}|${amount}|${postTime}|${normalized}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  const safeKey = key.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
  const safePkg = packageName.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
  return `bn_${safePkg}_${safeKey}_${hex}`.slice(0, 128);
}

function packageLabel(packageName: string): string {
  const tail = packageName.split('.').filter(Boolean).at(-1);
  return tail ? tail.toUpperCase() : 'Ngân hàng';
}
