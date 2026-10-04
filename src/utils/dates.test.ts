import { describe, expect, it } from 'vitest';

import { clampDay, formatIsoDate, getComparisonRanges, localDateFromDate } from '@/src/utils/dates';

const today = localDateFromDate(new Date(2026, 9, 3));

describe('ngày tương đối và kỳ so sánh', () => {
  it('so sánh tháng theo số ngày đã trôi qua', () => {
    const ranges = getComparisonRanges('month', today);
    expect(ranges.current).toEqual({ start: '2026-10-01', end: '2026-10-03' });
    expect(ranges.previous).toEqual({ start: '2026-09-01', end: '2026-09-03' });
  });

  it('tuần bắt đầu từ thứ hai và chỉ so cùng số ngày', () => {
    const ranges = getComparisonRanges('week', today);
    expect(ranges.current.start).toBe('2026-09-28');
    expect(ranges.current.end).toBe('2026-10-03');
    expect(ranges.previous.start).toBe('2026-09-21');
    expect(ranges.previous.end).toBe('2026-09-26');
  });

  it('năm nhuận không tạo ngày 29/2 giả ở năm thường', () => {
    const leap = clampDay(2023, 2, 29);
    expect(formatIsoDate(leap)).toBe('2023-02-28');
    const ranges = getComparisonRanges('year', { year: 2024, month: 2, day: 29 });
    expect(ranges.previous.end).toBe('2023-02-28');
  });

  it('ngày đơn so với hôm qua', () => {
    const ranges = getComparisonRanges('day', today);
    expect(ranges.current.start).toBe('2026-10-03');
    expect(ranges.previous.start).toBe('2026-10-02');
  });
});
