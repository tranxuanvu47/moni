import { describe, expect, it } from 'vitest';

import { averagePerElapsedDay, describeChange, fillDailySeries, fillMonthSeries, toCategorySlices } from '@/src/features/analytics/aggregate';
import { buildLocalInsight } from '@/src/features/analytics/insights';
import { evaluateBudget, shouldSendBudgetAlert } from '@/src/features/budgets/thresholds';

describe('tổng hợp kỳ', () => {
  it('điền ngày trống bằng 0', () => {
    expect(fillDailySeries('2026-10-01', '2026-10-03', [{ day: '2026-10-02', total: 50000 }])).toEqual([
      { label: '1', value: 0 },
      { label: '2', value: 50000 },
      { label: '3', value: 0 },
    ]);
  });

  it('năm có đủ 12 tháng kể cả tháng chưa phát sinh', () => {
    const series = fillMonthSeries([{ month: '02', total: 1000 }]);
    expect(series).toHaveLength(12);
    expect(series[0]?.value).toBe(0);
    expect(series[1]?.value).toBe(1000);
  });

  it('trung bình theo số ngày đã qua, không chia cho cả tháng', () => {
    expect(averagePerElapsedDay(90_000, '2026-10-01', '2026-10-03')).toBe(30_000);
  });

  it('không báo phần trăm khi kỳ trước bằng 0', () => {
    expect(describeChange(50000, 0).direction).toBe('na');
  });

  it('tỷ trọng hạng mục lấy từ số đã lưu', () => {
    const slices = toCategorySlices([
      { categoryId: 'a', name: 'Ăn uống', color: '#183D32', icon: 'utensils', total: 38000 },
      { categoryId: 'b', name: 'Di chuyển', color: '#3E5C76', icon: 'car', total: 62000 },
    ]);
    expect(slices[0]?.share).toBeCloseTo(0.38);
  });
});

describe('ngân sách', () => {
  it('cảnh báo 80% và vượt hạn mức', () => {
    expect(evaluateBudget(80_000, 100_000).level).toBe('warning');
    expect(evaluateBudget(120_000, 100_000).level).toBe('exceeded');
    expect(evaluateBudget(10_000, null).level).toBe('unset');
    expect(evaluateBudget(75_000, 100_000, 0.7, 0.9).level).toBe('warning');
    expect(evaluateBudget(95_000, 100_000, 0.7, 0.9).level).toBe('exceeded');
  });

  it('không gửi trùng cảnh báo trong tháng', () => {
    expect(shouldSendBudgetAlert('2026-10', '80', null)).toBe(true);
    expect(shouldSendBudgetAlert('2026-10', '80', '2026-10-80')).toBe(false);
    expect(shouldSendBudgetAlert('2026-10', '80', '2026-10-100')).toBe(false);
    expect(shouldSendBudgetAlert('2026-10', '100', '2026-10-80')).toBe(true);
  });
});

describe('nhận xét từ số liệu', () => {
  it('không bịa khi chưa có giao dịch', () => {
    expect(buildLocalInsight({ expenseTotal: 0, transactionCount: 0 })).toBe('Chưa có chi tiêu trong kỳ này.');
  });

  it('nêu hạng mục chiếm tỷ trọng lớn', () => {
    expect(
      buildLocalInsight({
        expenseTotal: 100000,
        transactionCount: 4,
        topCategoryName: 'Ăn uống',
        topCategoryShare: 0.38,
      }),
    ).toContain('38%');
  });
});
