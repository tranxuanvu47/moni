export type CategorizationTransactionType = 'expense' | 'income';

export interface CategorizationInput {
  transactionType: CategorizationTransactionType;
  merchant?: string | null;
  description?: string | null;
}

export interface UserCategorizationRule {
  id: string;
  categoryId: string;
  field: 'merchant' | 'description';
  operator: 'exact' | 'contains';
  pattern: string;
  transactionType?: CategorizationTransactionType | 'both';
  priority?: number;
  enabled?: boolean;
}

export interface ExactMerchantRule {
  id: string;
  merchant: string;
  categoryId: string;
  transactionType?: CategorizationTransactionType | 'both';
}

export interface LocalKeywordRule {
  id: string;
  keywords: readonly string[];
  categoryId: string;
  transactionType?: CategorizationTransactionType | 'both';
  /** Only explicitly reliable keyword rules participate in automatic categorization. */
  reliable: boolean;
  priority?: number;
}

export interface CategorizationRuleSet {
  userRules?: readonly UserCategorizationRule[];
  merchantRules?: readonly ExactMerchantRule[];
  keywordRules?: readonly LocalKeywordRule[];
}

export type CategorizationDecision =
  | { kind: 'category'; categoryId: string; source: 'user_rule' | 'exact_merchant' | 'local_keyword'; ruleId: string }
  | {
      kind: 'ai_fallback';
      source: 'ai_fallback';
      reason: 'no_deterministic_match';
      request: AiCategorizationFallbackRequest;
    };

/** Minimum-data contract. The caller still owns consent, transport, response validation, and review. */
export interface AiCategorizationFallbackRequest {
  transactionType: CategorizationTransactionType;
  normalizedMerchant: string | null;
  normalizedDescription: string;
}

export function resolveCategorization(input: CategorizationInput, rules: CategorizationRuleSet): CategorizationDecision {
  const merchant = normalizeCategorizationText(input.merchant);
  const description = normalizeCategorizationText(input.description);

  const userMatch = [...(rules.userRules ?? [])]
    .filter((rule) => rule.enabled !== false && appliesToType(rule.transactionType, input.transactionType))
    .sort(compareUserRules)
    .find((rule) => {
      const value = rule.field === 'merchant' ? merchant : description;
      return matches(value, normalizeCategorizationText(rule.pattern), rule.operator);
    });
  if (userMatch) {
    return { kind: 'category', categoryId: userMatch.categoryId, source: 'user_rule', ruleId: userMatch.id };
  }

  const merchantMatch = (rules.merchantRules ?? []).find(
    (rule) => appliesToType(rule.transactionType, input.transactionType) && merchant !== '' && merchant === normalizeCategorizationText(rule.merchant),
  );
  if (merchantMatch) {
    return { kind: 'category', categoryId: merchantMatch.categoryId, source: 'exact_merchant', ruleId: merchantMatch.id };
  }

  const keywordMatch = [...(rules.keywordRules ?? [])]
    .filter((rule) => rule.reliable && appliesToType(rule.transactionType, input.transactionType))
    .sort(compareKeywordRules)
    .find((rule) => rule.keywords.some((keyword) => containsPhrase(`${merchant} ${description}`.trim(), normalizeCategorizationText(keyword))));
  if (keywordMatch) {
    return { kind: 'category', categoryId: keywordMatch.categoryId, source: 'local_keyword', ruleId: keywordMatch.id };
  }

  return {
    kind: 'ai_fallback',
    source: 'ai_fallback',
    reason: 'no_deterministic_match',
    request: {
      transactionType: input.transactionType,
      normalizedMerchant: merchant || null,
      normalizedDescription: minimizeForAiFallback(input.description),
    },
  };
}

export function normalizeCategorizationText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, (character) => (character === 'Đ' ? 'D' : 'd'))
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compareUserRules(left: UserCategorizationRule, right: UserCategorizationRule): number {
  return (
    (right.priority ?? 0) - (left.priority ?? 0) ||
    normalizeCategorizationText(right.pattern).length - normalizeCategorizationText(left.pattern).length ||
    left.id.localeCompare(right.id)
  );
}

function compareKeywordRules(left: LocalKeywordRule, right: LocalKeywordRule): number {
  const leftLongest = Math.max(0, ...left.keywords.map((item) => normalizeCategorizationText(item).length));
  const rightLongest = Math.max(0, ...right.keywords.map((item) => normalizeCategorizationText(item).length));
  return (right.priority ?? 0) - (left.priority ?? 0) || rightLongest - leftLongest || left.id.localeCompare(right.id);
}

function appliesToType(
  ruleType: CategorizationTransactionType | 'both' | undefined,
  inputType: CategorizationTransactionType,
): boolean {
  return ruleType == null || ruleType === 'both' || ruleType === inputType;
}

function matches(value: string, pattern: string, operator: UserCategorizationRule['operator']): boolean {
  if (!value || !pattern) {
    return false;
  }
  return operator === 'exact' ? value === pattern : containsPhrase(value, pattern);
}

function containsPhrase(value: string, phrase: string): boolean {
  return phrase !== '' && ` ${value} `.includes(` ${phrase} `);
}

function minimizeForAiFallback(value: string | null | undefined): string {
  const redacted = (value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' sensitive-email ')
    .replace(/\b(?:\d[\s.-]?){6,}\b/g, ' sensitive-number ');
  return normalizeCategorizationText(redacted).slice(0, 160);
}
