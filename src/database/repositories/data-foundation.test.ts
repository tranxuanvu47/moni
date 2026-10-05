import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { createMemoryClient } from '@/src/database/memory-client';
import { migrate } from '@/src/database/migrate';
import {
  createAccount,
  getAccountBalance,
  getDefaultAccount,
  listAccounts,
  reconcileAccount,
  reorderAccounts,
  setAccountArchived,
} from '@/src/database/repositories/accounts';
import { getActiveBudget, listBudgets, upsertMonthlyBudget } from '@/src/database/repositories/budgets';
import {
  matchCategorizationRule,
  upsertCategorizationRule,
} from '@/src/database/repositories/categorization-rules';
import {
  confirmInboxDraft,
  confirmInboxDrafts,
  countReviewableInboxDrafts,
  createInboxDraft,
  getInboxDraft,
  listInboxDrafts,
  setInboxDraftStatus,
} from '@/src/database/repositories/inbox';
import {
  createRecurringRule,
  materializeRecurringTransactions,
  nextOccurrence,
} from '@/src/database/repositories/recurring';
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  sumAmount,
} from '@/src/database/repositories/transactions';
import { DEFAULT_ACCOUNT_ID } from '@/src/types/finance';

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = createMemoryClient(sqlite);
  await migrate(db);
  return db;
}

describe('migration v4', () => {
  it('backfill thu/chi vào ví mặc định nhưng không suy đoán transfer cũ', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (3, '2026-01-01T00:00:00');
      CREATE TABLE categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
      INSERT INTO categories VALUES ('cat_other', 'Khác');
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
        category_id TEXT NOT NULL, description TEXT NOT NULL, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, deleted_at TEXT, revision INTEGER NOT NULL, synced_revision INTEGER NOT NULL,
        device_id TEXT NOT NULL, sync_status TEXT NOT NULL, source TEXT NOT NULL, fingerprint TEXT,
        account_id TEXT, transfer_account_id TEXT
      );
      INSERT INTO transactions VALUES
        ('expense_old', 'expense', 10000, 'VND', 'cat_other', '', '2025-01-01T00:00:00', '2025-01-01T00:00:00', '2025-01-01T00:00:00', NULL, 1, 0, '', 'pending', 'manual', NULL, NULL, NULL),
        ('transfer_old', 'transfer', 50000, 'VND', 'cat_other', '', '2025-01-02T00:00:00', '2025-01-02T00:00:00', '2025-01-02T00:00:00', NULL, 1, 0, '', 'pending', 'manual', NULL, NULL, NULL);
      CREATE TABLE budgets (
        id TEXT PRIMARY KEY NOT NULL, category_id TEXT, amount INTEGER NOT NULL, period TEXT NOT NULL,
        effective_date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
        revision INTEGER NOT NULL, synced_revision INTEGER NOT NULL, device_id TEXT NOT NULL, sync_status TEXT NOT NULL
      );
    `);
    const db = createMemoryClient(sqlite);
    await migrate(db);

    expect((await db.get<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations'))?.version).toBe(4);
    expect((await getDefaultAccount(db)).id).toBe(DEFAULT_ACCOUNT_ID);
    expect((await db.get<{ account_id: string | null }>('SELECT account_id FROM transactions WHERE id = ?', ['expense_old']))?.account_id).toBe(
      DEFAULT_ACCOUNT_ID,
    );
    expect((await db.get<{ account_id: string | null }>('SELECT account_id FROM transactions WHERE id = ?', ['transfer_old']))?.account_id).toBeNull();
    expect((await db.get<{ transfer_fee: number }>('SELECT transfer_fee FROM transactions WHERE id = ?', ['transfer_old']))?.transfer_fee).toBe(0);
  });
});

describe('accounts and ledger', () => {
  it('derives balances from income, expense, transfer, fee and reconciliation adjustment', async () => {
    const db = await setup();
    const bank = await createAccount(db, {
      name: 'Ngân hàng',
      type: 'bank',
      openingBalance: 1_000_000,
      openingBalanceDate: '2026-01-01',
    });
    const wallet = await createAccount(db, {
      name: 'Ví điện tử',
      type: 'ewallet',
      openingBalance: 100_000,
      openingBalanceDate: '2026-01-01',
    });
    await createTransaction(db, {
      type: 'income', amount: 500_000, categoryId: 'cat_income', description: 'Lương',
      occurredAt: '2026-01-02T08:00:00', accountId: bank.id,
    });
    const expense = await createTransaction(db, {
      type: 'expense', amount: 100_000, categoryId: 'cat_food', description: 'Ăn',
      occurredAt: '2026-01-03T08:00:00', accountId: bank.id,
    });
    await createTransaction(db, {
      type: 'transfer', amount: 200_000, transferFee: 5_000, categoryId: 'cat_other', description: 'Nạp ví',
      occurredAt: '2026-01-04T08:00:00', accountId: bank.id, transferAccountId: wallet.id,
    });

    expect(await getAccountBalance(db, bank.id)).toBe(1_195_000);
    expect(await getAccountBalance(db, wallet.id)).toBe(300_000);
    expect(await sumAmount(db, { type: 'expense', start: '2026-01-01', end: '2026-01-31' })).toBe(100_000);

    const adjustment = await reconcileAccount(db, {
      accountId: bank.id,
      actualBalance: 1_200_000,
      occurredAt: '2026-01-05T08:00:00',
    });
    expect(adjustment?.amount).toBe(5_000);
    expect(await getAccountBalance(db, bank.id)).toBe(1_200_000);
    await deleteTransaction(db, expense.id);
    expect(await getAccountBalance(db, bank.id)).toBe(1_300_000);
  });

  it('validates transfers and supports archive/order without deleting history', async () => {
    const db = await setup();
    const one = await createAccount(db, { name: 'Một', type: 'cash', openingBalanceDate: '2026-01-01' });
    const two = await createAccount(db, { name: 'Hai', type: 'other', openingBalanceDate: '2026-01-01' });
    await expect(createTransaction(db, {
      type: 'transfer', amount: 10_000, categoryId: 'cat_other', description: '', occurredAt: '2026-01-01T00:00:00',
      accountId: one.id, transferAccountId: one.id,
    })).rejects.toThrow('khác nhau');
    await expect(createTransaction(db, {
      type: 'transfer', amount: 10_000, categoryId: 'cat_other', description: '', occurredAt: '2026-01-01T00:00:00',
    })).rejects.toThrow('nguồn');

    await reorderAccounts(db, [two.id, one.id, DEFAULT_ACCOUNT_ID]);
    const ordered = await listAccounts(db);
    expect(ordered.slice(0, 3).map((account) => account.id)).toEqual([two.id, one.id, DEFAULT_ACCOUNT_ID]);
    await setAccountArchived(db, one.id, true);
    expect((await listAccounts(db)).some((account) => account.id === one.id)).toBe(false);
    expect((await listAccounts(db, { includeArchived: true })).some((account) => account.id === one.id)).toBe(true);
  });
});

describe('transaction search and budgets', () => {
  it('filters locally by account/source/amount/search and supports stable sorts', async () => {
    const db = await setup();
    const bank = await createAccount(db, { name: 'TPBank chính', type: 'bank', openingBalanceDate: '2026-01-01' });
    await createTransaction(db, {
      type: 'expense', amount: 25_000, categoryId: 'cat_drink', description: 'Highlands',
      occurredAt: '2026-02-01T08:00:00', accountId: bank.id, source: 'bank_notification', fingerprint: 'bank_1',
    });
    await createTransaction(db, {
      type: 'expense', amount: 90_000, categoryId: 'cat_food', description: 'Bữa tối',
      occurredAt: '2026-02-02T08:00:00', accountId: DEFAULT_ACCOUNT_ID,
    });

    expect(await listTransactions(db, { search: 'TPBank', limit: 20, offset: 0 })).toHaveLength(1);
    expect(await listTransactions(db, { search: '25000', limit: 20, offset: 0 })).toHaveLength(1);
    expect(await listTransactions(db, { source: 'bank_notification', accountId: bank.id, limit: 20, offset: 0 })).toHaveLength(1);
    expect((await listTransactions(db, { minAmount: 20_000, maxAmount: 50_000, limit: 20, offset: 0 }))[0]?.amount).toBe(25_000);
    expect((await listTransactions(db, { sort: 'amount_desc', limit: 20, offset: 0 })).map((row) => row.amount)).toEqual([90_000, 25_000]);
  });

  it('keeps exact-month history and configurable thresholds', async () => {
    const db = await setup();
    await upsertMonthlyBudget(db, { categoryId: null, amount: 1_000_000, effectiveDate: '2026-01-01' });
    await upsertMonthlyBudget(db, {
      categoryId: null, amount: 2_000_000, effectiveDate: '2026-02-01', warningThresholdBps: 7500, limitThresholdBps: 9500,
    });
    await upsertMonthlyBudget(db, { categoryId: null, amount: 2_500_000, effectiveDate: '2026-02-01' });
    const budgets = (await listBudgets(db)).filter((budget) => budget.categoryId === null);
    expect(budgets).toHaveLength(2);
    expect((await getActiveBudget(db, null, '2026-01-20'))?.amount).toBe(1_000_000);
    expect((await getActiveBudget(db, null, '2026-02-20'))?.amount).toBe(2_500_000);
  });
});

describe('smart inbox', () => {
  it('is idempotent by source event, detects confirmed fingerprints and confirms drafts', async () => {
    const db = await setup();
    const input = {
      source: 'bank_notification' as const,
      sourceEventId: 'event-1',
      fingerprint: 'fp_1',
      proposedType: 'expense' as const,
      amount: 45_000,
      categoryId: 'cat_food',
      accountId: DEFAULT_ACCOUNT_ID,
      description: 'Bữa trưa',
      occurredAt: '2026-03-01T12:00:00',
    };
    const first = await createInboxDraft(db, input);
    const same = await createInboxDraft(db, input);
    expect(same.id).toBe(first.id);
    const transaction = await confirmInboxDraft(db, first.id);
    expect(transaction.accountId).toBe(DEFAULT_ACCOUNT_ID);
    expect((await getInboxDraft(db, first.id))?.status).toBe('confirmed');
    expect((await confirmInboxDraft(db, first.id)).id).toBe(transaction.id);

    const duplicate = await createInboxDraft(db, {
      ...input,
      sourceEventId: 'event-2',
    });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.duplicateOfId).toBe(transaction.id);
  });

  it('supports review/reject and bulk confirmation with per-row failures', async () => {
    const db = await setup();
    const ready = await createInboxDraft(db, {
      source: 'ai', proposedType: 'expense', amount: 10_000, categoryId: 'cat_other',
      description: 'Phí', accountId: DEFAULT_ACCOUNT_ID, occurredAt: '2026-03-01T00:00:00',
    });
    const incomplete = await createInboxDraft(db, { source: 'voice', status: 'needs_review', description: 'Không rõ' });
    const result = await confirmInboxDrafts(db, [ready.id, incomplete.id]);
    expect(result.confirmed).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    await setInboxDraftStatus(db, incomplete.id, 'rejected');
    expect((await listInboxDrafts(db, { statuses: ['rejected'], limit: 20, offset: 0 })).map((row) => row.id)).toEqual([
      incomplete.id,
    ]);
  });

  it('counts drafts that still need user review', async () => {
    const db = await setup();
    const ready = await createInboxDraft(db, {
      source: 'ai', proposedType: 'expense', amount: 10_000, categoryId: 'cat_other',
      description: 'Fee', accountId: DEFAULT_ACCOUNT_ID, occurredAt: '2026-03-01T00:00:00',
    });
    const review = await createInboxDraft(db, { source: 'voice', status: 'needs_review', description: 'Need review' });
    await createInboxDraft(db, {
      source: 'bank_notification',
      sourceEventId: 'duplicate-event',
      fingerprint: 'duplicate-fp',
      status: 'duplicate',
      description: 'Possible duplicate',
    });

    expect(await countReviewableInboxDrafts(db)).toBe(3);
    await confirmInboxDraft(db, ready.id);
    await setInboxDraftStatus(db, review.id, 'rejected');
    expect(await countReviewableInboxDrafts(db)).toBe(1);
  });
});

describe('recurring and categorization rules', () => {
  it('uses deterministic occurrence keys and preserves end-of-month intent', async () => {
    const db = await setup();
    const rule = await createRecurringRule(db, {
      type: 'expense', amount: 100_000, categoryId: 'cat_other', accountId: DEFAULT_ACCOUNT_ID,
      description: 'Thuê bao', startDate: '2026-01-31', endDate: '2026-03-31',
      frequency: 'monthly', mode: 'automatic', timezone: 'Asia/Bangkok',
    });
    expect(nextOccurrence('2026-01-31', 'monthly', 1, 31)).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', 'monthly', 1, 31)).toBe('2026-03-31');
    expect(await materializeRecurringTransactions(db, '2026-03-31')).toHaveLength(3);
    expect(await materializeRecurringTransactions(db, '2026-03-31')).toHaveLength(0);
    const rows = await listTransactions(db, { limit: 20, offset: 0 });
    expect(rows.map((row) => row.occurrenceKey).sort()).toEqual([
      `${rule.id}:2026-01-31`, `${rule.id}:2026-02-28`, `${rule.id}:2026-03-31`,
    ]);
  });

  it('matches learned rules in user/exact/keyword priority order', async () => {
    const db = await setup();
    await upsertCategorizationRule(db, { matchKind: 'keyword', pattern: 'highlands', categoryId: 'cat_food' });
    await upsertCategorizationRule(db, { matchKind: 'exact_merchant', pattern: 'HIGHLANDS', categoryId: 'cat_drink' });
    await upsertCategorizationRule(db, { matchKind: 'user_defined', pattern: 'highlands', categoryId: 'cat_shopping' });
    const matched = await matchCategorizationRule(db, { description: 'Thanh toán Highlands', merchant: 'Highlands' });
    expect(matched?.categoryId).toBe('cat_shopping');
  });
});
