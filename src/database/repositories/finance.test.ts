import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { createMemoryClient } from '@/src/database/memory-client';
import { migrate } from '@/src/database/migrate';
import { listCategories } from '@/src/database/repositories/categories';
import { getPreference, setPreference } from '@/src/database/repositories/preferences';
import { upsertMonthlyBudget, getActiveBudget } from '@/src/database/repositories/budgets';
import {
  countTransactions,
  createTransaction,
  deleteTransaction,
  listTransactions,
  sumAmount,
  updateTransaction,
} from '@/src/database/repositories/transactions';

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = createMemoryClient(sqlite);
  await migrate(db);
  return db;
}

describe('SQLite', () => {
  it('migration tạo hạng mục mặc định và không sinh giao dịch mẫu', async () => {
    const db = await setup();
    const categories = await listCategories(db);
    expect(categories.map((category) => category.name)).toContain('Ăn uống');
    expect(await countTransactions(db, { type: 'expense', start: '2020-01-01', end: '2030-01-01' })).toBe(0);
    await migrate(db);
    expect(await listCategories(db)).toHaveLength(categories.length);
  });

  it('tạo, sửa, xóa và cộng tiền bằng số nguyên', async () => {
    const db = await setup();
    const created = await createTransaction(db, {
      type: 'expense',
      amount: 35000,
      categoryId: 'cat_food',
      description: 'Ăn sáng',
      occurredAt: '2026-10-03T08:15:00',
    });
    expect(created.amount).toBe(35000);

    await updateTransaction(db, created.id, {
      type: 'expense',
      amount: 45000,
      categoryId: 'cat_drink',
      description: 'Cà phê',
      occurredAt: '2026-10-02T08:15:00',
    });

    expect(await sumAmount(db, { type: 'expense', start: '2026-10-01', end: '2026-10-03' })).toBe(45000);
    const listed = await listTransactions(db, { search: 'cà phê', limit: 20, offset: 0 });
    expect(listed).toHaveLength(1);

    await deleteTransaction(db, created.id);
    expect(await listTransactions(db, { limit: 20, offset: 0 })).toHaveLength(0);
  });

  it('lưu ngân sách và preference', async () => {
    const db = await setup();
    await upsertMonthlyBudget(db, { categoryId: null, amount: 2_000_000, effectiveDate: '2026-10-01' });
    await setPreference(db, 'reminder_enabled', '1');
    expect((await getActiveBudget(db, null, '2026-10-03'))?.amount).toBe(2_000_000);
    expect(await getPreference(db, 'reminder_enabled')).toBe('1');
  });
});
