export type TransactionType = 'expense' | 'income' | 'transfer';

export const DEFAULT_ACCOUNT_ID = 'account_default_cash';

export type AccountType = 'cash' | 'bank' | 'ewallet' | 'other';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  bankCode: string | null;
  maskedIdentifier: string | null;
  currency: 'VND';
  openingBalance: number;
  openingBalanceDate: string;
  archivedAt: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountWithBalance extends Account {
  balance: number;
}

export interface AccountAdjustment {
  id: string;
  accountId: string;
  amount: number;
  reason: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export type CategoryKind = 'expense' | 'income' | 'both';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: CategoryKind;
  isDefault: boolean;
  sortOrder: number;
}

export interface TransactionRecord {
  id: string;
  type: TransactionType;
  amount: number;
  currency: 'VND';
  categoryId: string;
  description: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  source: TransactionSource;
  fingerprint: string | null;
  accountId: string | null;
  transferAccountId: string | null;
  transferFee: number;
  recurringRuleId: string | null;
  occurrenceKey: string | null;
}

export interface TransactionListItem extends TransactionRecord {
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  attachmentCount: number;
  accountName: string | null;
  transferAccountName: string | null;
}

export interface Attachment {
  id: string;
  transactionId: string;
  localUri: string;
  mimeType: string;
  createdAt: string;
}

export interface Budget {
  id: string;
  categoryId: string | null;
  amount: number;
  period: 'month';
  effectiveDate: string;
  warningThresholdBps: number;
  limitThresholdBps: number;
}

export interface TransactionDraft {
  id: string;
  type: TransactionType;
  amount: number | null;
  currency: 'VND';
  categoryId: string | null;
  categoryName: string;
  description: string;
  date: string;
  needsReview: boolean;
  reviewReason?: string;
  categoryUncertain: boolean;
  attachmentUri?: string | null;
}

export type TransactionSource = 'manual' | 'ai' | 'voice' | 'image' | 'bank_notification' | 'sheets';

export interface TransactionInput {
  type: TransactionType;
  amount: number;
  categoryId: string;
  description: string;
  occurredAt: string;
  source?: TransactionSource;
  fingerprint?: string | null;
  accountId?: string | null;
  transferAccountId?: string | null;
  transferFee?: number;
  recurringRuleId?: string | null;
  occurrenceKey?: string | null;
}

export type TransactionSort = 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';

export type InboxSource = TransactionSource | 'imported_statement';
export type InboxStatus = 'pending' | 'confirmed' | 'rejected' | 'duplicate' | 'needs_review';

export interface TransactionInboxDraft {
  id: string;
  source: InboxSource;
  sourceEventId: string | null;
  fingerprint: string | null;
  status: InboxStatus;
  proposedType: TransactionType | null;
  amount: number | null;
  currency: 'VND';
  categoryId: string | null;
  accountId: string | null;
  transferAccountId: string | null;
  description: string;
  occurredAt: string | null;
  confidence: number | null;
  duplicateOfId: string | null;
  confirmedTransactionId: string | null;
  rawPayload: string | null;
  detectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurringMode = 'automatic' | 'reminder';

export interface RecurringRule {
  id: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  accountId: string;
  transferAccountId: string | null;
  transferFee: number;
  description: string;
  startDate: string;
  endDate: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  mode: RecurringMode;
  timezone: string;
  anchorDay: number;
  nextOccurrenceDate: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CategorizationMatchKind = 'user_defined' | 'exact_merchant' | 'keyword';

export interface CategorizationRule {
  id: string;
  matchKind: CategorizationMatchKind;
  pattern: string;
  normalizedPattern: string;
  categoryId: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PeriodKind = 'day' | 'week' | 'month' | 'year';
