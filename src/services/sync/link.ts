import type { DatabaseClient } from '@/src/database/client';

export interface LinkCounts {
  transactions: number;
  customCategories: number;
  budgets: number;
}

export type LinkAction = 'resume' | 'confirm' | 'blocked';

export function hasLocalFinance(counts: LinkCounts): boolean {
  return counts.transactions > 0 || counts.customCategories > 0 || counts.budgets > 0;
}

export function decideAccountLink(linkedUid: string | null, nextUid: string, counts: LinkCounts): LinkAction {
  if (linkedUid && linkedUid !== nextUid) {
    return 'blocked';
  }
  if (linkedUid === nextUid) {
    return 'resume';
  }
  if (hasLocalFinance(counts)) {
    return 'confirm';
  }
  return 'resume';
}

export function isOwner(authUid: string | null, userId: string): boolean {
  return authUid !== null && authUid === userId;
}

export async function countLocalFinance(db: DatabaseClient): Promise<LinkCounts> {
  const [transactions, customCategories, budgets] = await Promise.all([
    db.get<{ total: number }>('SELECT COUNT(*) AS total FROM transactions'),
    db.get<{ total: number }>(
      'SELECT COUNT(*) AS total FROM categories WHERE is_default = 0 AND deleted_at IS NULL',
    ),
    db.get<{ total: number }>('SELECT COUNT(*) AS total FROM budgets WHERE deleted_at IS NULL'),
  ]);
  return {
    transactions: transactions?.total ?? 0,
    customCategories: customCategories?.total ?? 0,
    budgets: budgets?.total ?? 0,
  };
}
