import type { Category, TransactionDraft } from '@/src/types/finance';
import { OTHER_CATEGORY_ID } from '@/src/features/categories/defaults';
import { createId } from '@/src/utils/id';

const MAX_AMOUNT = 10_000_000_000;

export function validateAiTransactions(payload: unknown, categories: Category[], fallbackDate: string): TransactionDraft[] {
  if (!payload || typeof payload !== 'object' || !('transactions' in payload)) {
    throw new Error('Kết quả AI không đúng định dạng.');
  }

  const transactions = (payload as { transactions?: unknown }).transactions;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new Error('AI không tách được giao dịch nào.');
  }

  if (transactions.length > 20) {
    throw new Error('AI trả về quá nhiều giao dịch.');
  }

  return transactions.map((item) => validateOne(item, categories, fallbackDate));
}

export function extractJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? content;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('AI không trả về JSON.');
  }
  return JSON.parse(source.slice(start, end + 1)) as unknown;
}

function validateOne(item: unknown, categories: Category[], fallbackDate: string): TransactionDraft {
  if (!item || typeof item !== 'object') {
    throw new Error('Một giao dịch AI không hợp lệ.');
  }

  const record = item as Record<string, unknown>;
  const type = record.type === 'income' ? 'income' : record.type === 'expense' ? 'expense' : null;
  if (!type) {
    throw new Error('Loại giao dịch từ AI không hợp lệ.');
  }

  const amount = normalizeAmount(record.amount);
  const categoryName = typeof record.category === 'string' ? record.category.trim() : '';
  const category = categories.find((entry) => entry.name.toLocaleLowerCase('vi') === categoryName.toLocaleLowerCase('vi'));
  const resolved = category ?? categories.find((entry) => entry.id === OTHER_CATEGORY_ID);
  const date = typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date) ? record.date : fallbackDate;
  const description = typeof record.description === 'string' ? record.description.trim().slice(0, 120) : '';
  const needsReview = amount == null;

  return {
    id: createId(),
    type,
    amount,
    currency: 'VND',
    categoryId: resolved?.id ?? null,
    categoryName: resolved?.name ?? 'Khác',
    description: description || resolved?.name || 'Giao dịch',
    date,
    needsReview,
    reviewReason: needsReview ? 'AI chưa xác định số tiền. Hãy nhập trước khi lưu.' : undefined,
    categoryUncertain: !category,
  };
}

function normalizeAmount(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const amount = Math.round(value);
  if (amount <= 0 || amount > MAX_AMOUNT) {
    return null;
  }
  return amount;
}
