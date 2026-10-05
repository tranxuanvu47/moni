import { describe, expect, it } from 'vitest';

import { generateRecurringOccurrences, recurringOccurrenceKey } from '@/src/features/recurring/occurrences';

describe('recurring occurrence generation', () => {
  it('supports daily and weekly intervals', () => {
    expect(
      generateRecurringOccurrences(
        { id: 'daily', frequency: 'daily', interval: 2, startDate: '2026-10-01' },
        { startDate: '2026-10-03', endDate: '2026-10-08' },
      ).map((item) => item.date),
    ).toEqual(['2026-10-03', '2026-10-05', '2026-10-07']);

    expect(
      generateRecurringOccurrences(
        { id: 'weekly', frequency: 'weekly', interval: 2, startDate: '2026-09-28' },
        { startDate: '2026-10-01', endDate: '2026-11-01' },
      ).map((item) => item.date),
    ).toEqual(['2026-10-12', '2026-10-26']);
  });

  it('clamps month end without drifting the anchor day', () => {
    expect(
      generateRecurringOccurrences(
        { id: 'month-end', frequency: 'monthly', interval: 1, startDate: '2025-01-31' },
        { startDate: '2025-01-01', endDate: '2025-04-30' },
      ).map((item) => item.date),
    ).toEqual(['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30']);
  });

  it('restores leap day when a later occurrence supports it', () => {
    expect(
      generateRecurringOccurrences(
        { id: 'leap', frequency: 'yearly', interval: 1, startDate: '2024-02-29' },
        { startDate: '2024-01-01', endDate: '2028-12-31' },
      ).map((item) => item.date),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('uses inclusive rule/range ends and date-only semantics across DST dates', () => {
    expect(
      generateRecurringOccurrences(
        { id: 'dst-safe', frequency: 'daily', interval: 1, startDate: '2026-03-28', endDate: '2026-03-30' },
        { startDate: '2026-03-29', endDate: '2026-03-31' },
      ).map((item) => item.date),
    ).toEqual(['2026-03-29', '2026-03-30']);
  });

  it('creates a deterministic occurrence key and rejects invalid intervals', () => {
    expect(recurringOccurrenceKey('rent-rule', '2026-10-01')).toBe('recurring:rent-rule:2026-10-01');
    expect(() =>
      generateRecurringOccurrences(
        { id: 'invalid', frequency: 'monthly', interval: 0, startDate: '2026-01-01' },
        { startDate: '2026-01-01', endDate: '2026-02-01' },
      ),
    ).toThrow('interval');
  });
});
