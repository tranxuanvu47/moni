import { describe, expect, it } from 'vitest';

import { normalizeCategorizationText, resolveCategorization } from '@/src/features/categorization/rules';

const rules = {
  userRules: [
    {
      id: 'user-highlands',
      categoryId: 'coffee',
      field: 'merchant' as const,
      operator: 'exact' as const,
      pattern: 'Highlands Coffee',
      priority: 10,
    },
  ],
  merchantRules: [{ id: 'merchant-highlands', merchant: 'HIGHLANDS COFFEE', categoryId: 'dining' }],
  keywordRules: [
    { id: 'keyword-coffee', keywords: ['coffee'], categoryId: 'drinks', reliable: true, priority: 1 },
    { id: 'keyword-transfer', keywords: ['chuyển khoản'], categoryId: 'other', reliable: false, priority: 100 },
  ],
};

describe('learned categorization precedence', () => {
  it('normalizes Vietnamese accents, case, and punctuation', () => {
    expect(normalizeCategorizationText('  CÀ-PHÊ ĐÁ  ')).toBe('ca phe da');
  });

  it('gives user rules precedence over merchant and keyword rules', () => {
    expect(resolveCategorization({ transactionType: 'expense', merchant: 'HIGHLANDS—COFFEE', description: 'coffee' }, rules)).toEqual({
      kind: 'category',
      categoryId: 'coffee',
      source: 'user_rule',
      ruleId: 'user-highlands',
    });
  });

  it('uses exact merchant before reliable local keywords', () => {
    expect(
      resolveCategorization(
        { transactionType: 'expense', merchant: 'Highlands Coffee', description: 'coffee' },
        { ...rules, userRules: [] },
      ),
    ).toMatchObject({ categoryId: 'dining', source: 'exact_merchant' });
  });

  it('uses only reliable keyword rules before AI fallback', () => {
    expect(
      resolveCategorization(
        { transactionType: 'expense', description: 'Mua coffee mang đi' },
        { ...rules, userRules: [], merchantRules: [] },
      ),
    ).toMatchObject({ categoryId: 'drinks', source: 'local_keyword' });

    expect(
      resolveCategorization(
        { transactionType: 'expense', description: 'Chuyển khoản nội bộ' },
        { ...rules, userRules: [], merchantRules: [] },
      ).kind,
    ).toBe('ai_fallback');
  });

  it('returns a redacted minimum-data AI fallback contract', () => {
    const decision = resolveCategorization(
      {
        transactionType: 'expense',
        merchant: 'Unknown Store',
        description: 'Thanh toán từ 123456789012 cho me@example.com',
      },
      {},
    );
    expect(decision.kind).toBe('ai_fallback');
    if (decision.kind === 'ai_fallback') {
      expect(decision.request).toEqual({
        transactionType: 'expense',
        normalizedMerchant: 'unknown store',
        normalizedDescription: 'thanh toan tu sensitive number cho sensitive email',
      });
    }
  });
});
