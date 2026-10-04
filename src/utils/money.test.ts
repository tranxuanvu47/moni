import { describe, expect, it } from 'vitest';

import { findAmount, formatCompactVnd, formatVnd } from '@/src/utils/money';

describe('định dạng VND', () => {
  it('nhóm hàng nghìn bằng dấu chấm', () => {
    expect(formatVnd(50000)).toBe('50.000 ₫');
    expect(formatVnd(120000)).toBe('120.000 ₫');
    expect(formatVnd(1250000)).toBe('1.250.000 ₫');
  });

  it('rút gọn cho biểu đồ', () => {
    expect(formatCompactVnd(50000)).toBe('50k');
    expect(formatCompactVnd(1200000)).toBe('1,2 triệu');
  });
});

describe('đọc số tiền tiếng Việt', () => {
  it.each([
    ['35k', 35000],
    ['45 nghìn', 45000],
    ['100k', 100000],
    ['350 ngàn', 350000],
    ['1,2 triệu', 1200000],
    ['1.5tr', 1500000],
    ['50.000', 50000],
    ['1.250.000', 1250000],
    ['120.000 ₫', 120000],
    ['2000000', 2000000],
  ])('%s = %i', (input, expected) => {
    expect(findAmount(input)?.amount).toBe(expected);
    expect(findAmount(input)?.ambiguous).toBe(false);
  });

  it('không bịa số tiền khi thiếu đơn vị', () => {
    const match = findAmount('ăn sáng 35');
    expect(match?.amount).toBeNull();
    expect(match?.ambiguous).toBe(true);
  });

  it('không nhầm 100kg thành 100k', () => {
    expect(findAmount('mua 100kg gạo')?.amount).toBeNull();
  });
});
