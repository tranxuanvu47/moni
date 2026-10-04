import type { DatabaseClient } from '@/src/database/client';
import { getDeviceId } from '@/src/services/sync/device';
import { noteLocalChange } from '@/src/services/sync/outbox';
import type { Budget } from '@/src/types/finance';
import { createUuid } from '@/src/utils/id';
import { toLocalDateTime } from '@/src/utils/dates';

interface BudgetRow {
  id: string;
  category_id: string | null;
  amount: number;
  period: 'month';
  effective_date: string;
}

export async function listBudgets(db: DatabaseClient): Promise<Budget[]> {
  const rows = await db.all<BudgetRow>('SELECT * FROM budgets WHERE deleted_at IS NULL ORDER BY effective_date DESC');
  return rows.map(mapBudget);
}

export async function getActiveBudget(db: DatabaseClient, categoryId: string | null, today: string): Promise<Budget | null> {
  const row = categoryId
    ? await db.get<BudgetRow>(
        `SELECT * FROM budgets
         WHERE category_id = ? AND period = 'month' AND effective_date <= ? AND deleted_at IS NULL
         ORDER BY effective_date DESC LIMIT 1`,
        [categoryId, today],
      )
    : await db.get<BudgetRow>(
        `SELECT * FROM budgets
         WHERE category_id IS NULL AND period = 'month' AND effective_date <= ? AND deleted_at IS NULL
         ORDER BY effective_date DESC LIMIT 1`,
        [today],
      );
  return row ? mapBudget(row) : null;
}

export async function upsertMonthlyBudget(
  db: DatabaseClient,
  input: { categoryId: string | null; amount: number; effectiveDate: string },
): Promise<void> {
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  const existing = input.categoryId
    ? await db.get<{ id: string }>(
        `SELECT id FROM budgets WHERE category_id = ? AND period = 'month' AND deleted_at IS NULL ORDER BY effective_date DESC LIMIT 1`,
        [input.categoryId],
      )
    : await db.get<{ id: string }>(
        `SELECT id FROM budgets WHERE category_id IS NULL AND period = 'month' AND deleted_at IS NULL ORDER BY effective_date DESC LIMIT 1`,
      );

  if (existing) {
    await db.run(
      `UPDATE budgets
       SET amount = ?, effective_date = ?, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
       WHERE id = ?`,
      [input.amount, input.effectiveDate, now, deviceId, existing.id],
    );
    const row = await db.get<{ revision: number }>('SELECT revision FROM budgets WHERE id = ?', [existing.id]);
    await noteLocalChange(db, 'budgets', existing.id, row?.revision ?? 1, now);
    return;
  }

  const id = createUuid();
  await db.run(
    `INSERT INTO budgets (
       id, category_id, amount, period, effective_date, created_at, updated_at, deleted_at,
       revision, synced_revision, device_id, sync_status
     ) VALUES (?, ?, ?, 'month', ?, ?, ?, NULL, 1, 0, ?, 'pending')`,
    [id, input.categoryId, input.amount, input.effectiveDate, now, now, deviceId],
  );
  await noteLocalChange(db, 'budgets', id, 1, now);
}

export async function deleteBudget(db: DatabaseClient, id: string): Promise<void> {
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE budgets
     SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [now, now, deviceId, id],
  );
  const row = await db.get<{ revision: number }>('SELECT revision FROM budgets WHERE id = ?', [id]);
  if (row) {
    await noteLocalChange(db, 'budgets', id, row.revision, now);
  }
}

function mapBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    categoryId: row.category_id,
    amount: row.amount,
    period: 'month',
    effectiveDate: row.effective_date,
  };
}
