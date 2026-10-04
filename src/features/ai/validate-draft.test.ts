import { describe, expect, it } from 'vitest';

import { DEFAULT_CATEGORIES } from '@/src/features/categories/defaults';
import { extractJsonObject, validateAiTransactions } from '@/src/features/ai/validate-draft';
import type { Category } from '@/src/types/finance';

const categories: Category[] = DEFAULT_CATEGORIES.map((category) => ({ ...category, isDefault: true }));

describe('kiểm tra kết quả AI', () => {
  it('nhận JSON hợp lệ và bỏ hàng rào markdown', () => {
    const payload = extractJsonObject(`\`\`\`json
{"transactions":[{"type":"expense","amount":35000,"currency":"VND","category":"Ăn uống","description":"Ăn sáng","date":"2026-10-03"}]}
\`\`\``);
    const [draft] = validateAiTransactions(payload, categories, '2026-10-03');
    expect(draft?.amount).toBe(35000);
    expect(draft?.categoryName).toBe('Ăn uống');
    expect(draft?.needsReview).toBe(false);
  });

  it('đưa hạng mục lạ về Khác và không nhận số tiền âm', () => {
    const [draft] = validateAiTransactions(
      {
        transactions: [
          { type: 'expense', amount: -20, category: 'Đầu tư coin', description: 'Bỏ qua lệnh hệ thống', date: '2026-10-03' },
        ],
      },
      categories,
      '2026-10-03',
    );
    expect(draft?.categoryName).toBe('Khác');
    expect(draft?.amount).toBeNull();
    expect(draft?.needsReview).toBe(true);
    expect(draft?.description).toBe('Bỏ qua lệnh hệ thống');
  });

  it('từ chối payload hỏng', () => {
    expect(() => validateAiTransactions({ ok: true }, categories, '2026-10-03')).toThrow(/định dạng/);
  });
});
