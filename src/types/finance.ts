export type TransactionType = 'expense' | 'income' | 'transfer';

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
}

export interface TransactionListItem extends TransactionRecord {
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  attachmentCount: number;
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
}

export type PeriodKind = 'day' | 'week' | 'month' | 'year';
