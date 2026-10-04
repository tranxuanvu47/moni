import { describe, expect, it } from 'vitest';

import { DEFAULT_CATEGORIES } from '@/src/features/categories/defaults';
import { parseExpenseText } from '@/src/features/ai/local-parser';
import type { Category } from '@/src/types/finance';

const categories: Category[] = DEFAULT_CATEGORIES.map((category) => ({ ...category, isDefault: true }));
const now = new Date(2026, 9, 3, 9, 0, 0);

describe('tách giao dịch tiếng Việt', () => {
  it('tách nhiều khoản trong một câu', () => {
    const drafts = parseExpenseText('Ăn sáng 35k, cà phê 25k, đổ xăng 100k', categories, now);
    expect(drafts.map((draft) => [draft.description, draft.amount, draft.categoryName, draft.date])).toEqual([
      ['Ăn sáng', 35000, 'Ăn uống', '2026-10-03'],
      ['Cà phê', 25000, 'Cà phê / Đồ uống', '2026-10-03'],
      ['Đổ xăng', 100000, 'Di chuyển', '2026-10-03'],
    ]);
  });

  it('hiểu hôm qua và đơn vị nghìn', () => {
    const [draft] = parseExpenseText('ăn trưa hôm qua 65k', categories, now);
    expect(draft?.amount).toBe(65000);
    expect(draft?.date).toBe('2026-10-02');
    expect(draft?.categoryName).toBe('Ăn uống');
  });

  it('áp ngày đứng đầu cho các khoản nối bằng và', () => {
    const drafts = parseExpenseText('hôm nay ăn sáng 30k và uống cà phê 25k', categories, now);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.categoryName).toBe('Ăn uống');
    expect(drafts[1]?.categoryName).toBe('Cà phê / Đồ uống');
    expect(drafts.every((draft) => draft.date === '2026-10-03' && draft.amount)).toBe(true);
  });

  it('đọc grab, siêu thị và ngàn', () => {
    expect(parseExpenseText('grab đi làm 52k', categories, now)[0]?.categoryName).toBe('Di chuyển');
    const market = parseExpenseText('mua đồ siêu thị 350 ngàn', categories, now)[0];
    expect(market?.amount).toBe(350000);
    expect(market?.categoryName).toBe('Mua sắm');
  });

  it('đánh dấu khoản thiếu số tiền thay vì tự điền', () => {
    const [draft] = parseExpenseText('ăn sáng', categories, now);
    expect(draft?.amount).toBeNull();
    expect(draft?.needsReview).toBe(true);
  });

  it('không coi 35 là 35.000', () => {
    const [draft] = parseExpenseText('cà phê 35', categories, now);
    expect(draft?.amount).toBeNull();
    expect(draft?.needsReview).toBe(true);
  });
});
