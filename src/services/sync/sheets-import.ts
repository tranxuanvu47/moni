import type { DatabaseClient } from '@/src/database/client';
import { parseMetadata, parseSnapshot, supportedSchema } from '@/src/services/sync/codec';
import { ENTITY_SHEETS, SHEET_NAMES, type SyncEntityName } from '@/src/services/sync/constants';
import { getDeviceId } from '@/src/services/sync/device';
import { noteLocalChange } from '@/src/services/sync/outbox';
import type { CanonicalRecord, SheetSnapshot } from '@/src/services/sync/types';

const ORDER: SyncEntityName[] = ['categories', 'settings', 'budgets', 'transactions'];

export interface MoneyTotals {
  count: number;
  income: number;
  expense: number;
}

export interface SheetImportReport {
  inserted: number;
  alreadyPresent: number;
  skipped: number;
  sheet: MoneyTotals;
  local: MoneyTotals;
}

export async function importSheetSnapshots(
  db: DatabaseClient,
  sheets: Partial<Record<string, SheetSnapshot>>,
): Promise<SheetImportReport> {
  const metadata = parseMetadata(sheets[SHEET_NAMES.metadata]);
  if (metadata.invalid || !supportedSchema(metadata.version)) {
    throw new Error('File Google Sheets dùng phiên bản mới hơn ứng dụng. Chưa nhập vào máy.');
  }

  const remote: CanonicalRecord[] = [];
  let skipped = 0;
  for (const entity of ORDER) {
    const parsed = parseSnapshot(entity, sheets[ENTITY_SHEETS[entity]]);
    remote.push(...parsed.records);
    skipped += parsed.skipped;
  }

  const deviceId = await getDeviceId(db);
  let inserted = 0;
  let alreadyPresent = 0;
  await db.transaction(async () => {
    for (const entity of ORDER) {
      for (const record of remote.filter((item) => item.entity === entity)) {
        const outcome = await importOne(db, record, deviceId);
        if (outcome === 'inserted') {
          inserted += 1;
        } else if (outcome === 'exists') {
          alreadyPresent += 1;
        } else {
          skipped += 1;
        }
      }
    }
  });

  return {
    inserted,
    alreadyPresent,
    skipped,
    sheet: summarizeTransactions(remote),
    local: await localTransactionTotals(db),
  };
}

export function summarizeTransactions(records: CanonicalRecord[]): MoneyTotals {
  let count = 0;
  let income = 0;
  let expense = 0;
  for (const record of records) {
    if (record.entity !== 'transactions' || record.fields.deleted_at) {
      continue;
    }
    count += 1;
    const amount = Number(record.fields.amount);
    if (record.fields.type === 'income') {
      income += amount;
    } else if (record.fields.type === 'expense') {
      expense += amount;
    }
  }
  return { count, income, expense };
}

async function localTransactionTotals(db: DatabaseClient): Promise<MoneyTotals> {
  const row = await db.get<{ count: number | null; income: number | null; expense: number | null }>(
    `SELECT
       SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS count,
       SUM(CASE WHEN type = 'income' AND deleted_at IS NULL THEN amount ELSE 0 END) AS income,
       SUM(CASE WHEN type = 'expense' AND deleted_at IS NULL THEN amount ELSE 0 END) AS expense
     FROM transactions`,
  );
  return {
    count: row?.count ?? 0,
    income: row?.income ?? 0,
    expense: row?.expense ?? 0,
  };
}

async function importOne(db: DatabaseClient, record: CanonicalRecord, deviceId: string): Promise<'inserted' | 'exists' | 'skipped'> {
  if (await exists(db, record)) {
    return 'exists';
  }
  if (record.entity === 'transactions') {
    const category = await db.get<{ id: string }>('SELECT id FROM categories WHERE id = ?', [record.fields.category_id]);
    if (!category) {
      return 'skipped';
    }
    const fingerprint = record.fields.fingerprint || null;
    if (fingerprint) {
      const duplicate = await db.get<{ id: string }>(
        'SELECT id FROM transactions WHERE fingerprint = ? AND deleted_at IS NULL',
        [fingerprint],
      );
      if (duplicate) {
        return 'skipped';
      }
    }
    await db.run(
      `INSERT INTO transactions (
         id, type, amount, currency, category_id, description, occurred_at, created_at, updated_at, deleted_at,
         revision, synced_revision, device_id, sync_status, source, fingerprint, account_id, transfer_account_id
       ) VALUES (?, ?, ?, 'VND', ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?, ?, ?)`,
      [
        record.id,
        record.fields.type,
        Number(record.fields.amount),
        record.fields.category_id,
        record.fields.description ?? '',
        record.fields.occurred_at,
        record.fields.created_at,
        record.updatedAt,
        record.fields.deleted_at || null,
        record.revision,
        deviceId,
        record.fields.source || 'sheets',
        fingerprint,
        record.fields.account_id || null,
        record.fields.transfer_account_id || null,
      ],
    );
  } else if (record.entity === 'categories') {
    await db.run(
      `INSERT INTO categories (
         id, name, icon, color, type, is_default, sort_order, created_at, updated_at, deleted_at,
         revision, synced_revision, device_id, sync_status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [
        record.id,
        record.fields.name,
        record.fields.icon,
        record.fields.color,
        record.fields.type,
        Number(record.fields.is_default),
        Number(record.fields.sort_order),
        record.fields.created_at,
        record.updatedAt,
        record.fields.deleted_at || null,
        record.revision,
        deviceId,
      ],
    );
  } else if (record.entity === 'budgets') {
    await db.run(
      `INSERT INTO budgets (
         id, category_id, amount, period, effective_date, created_at, updated_at, deleted_at,
         revision, synced_revision, device_id, sync_status
       ) VALUES (?, ?, ?, 'month', ?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [
        record.id,
        record.fields.category_id || null,
        Number(record.fields.amount),
        record.fields.effective_date,
        record.fields.created_at,
        record.updatedAt,
        record.fields.deleted_at || null,
        record.revision,
        deviceId,
      ],
    );
  } else {
    await db.run(
      `INSERT INTO preferences (key, value, updated_at, deleted_at, revision, synced_revision, device_id, sync_status)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [record.id, record.fields.value ?? '', record.updatedAt, record.fields.deleted_at || null, record.revision, deviceId],
    );
  }
  await noteLocalChange(db, record.entity, record.id, record.revision, record.updatedAt);
  return 'inserted';
}

async function exists(db: DatabaseClient, record: CanonicalRecord): Promise<boolean> {
  if (record.entity === 'settings') {
    const row = await db.get<{ key: string }>('SELECT key FROM preferences WHERE key = ?', [record.id]);
    return Boolean(row);
  }
  const table = record.entity;
  const row = await db.get<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [record.id]);
  return Boolean(row);
}
