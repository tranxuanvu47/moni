import type { DatabaseClient } from '@/src/database/client';
import { getDeviceId } from '@/src/services/sync/device';
import { noteLocalChange } from '@/src/services/sync/outbox';
import type { Attachment, TransactionInput, TransactionListItem, TransactionRecord, TransactionType } from '@/src/types/finance';
import { createId, createUuid } from '@/src/utils/id';
import { toLocalDateTime } from '@/src/utils/dates';

interface TransactionRow {
  id: string;
  type: TransactionType;
  amount: number;
  currency: 'VND';
  category_id: string;
  description: string;
  occurred_at: string;
  created_at: string;
  updated_at: string;
  category_name: string;
  category_icon: string;
  category_color: string;
  attachment_count: number;
}

export interface TransactionQuery {
  search?: string;
  type?: TransactionType | null;
  categoryId?: string | null;
  from?: string | null;
  to?: string | null;
  limit: number;
  offset: number;
}

export async function createTransaction(db: DatabaseClient, input: TransactionInput): Promise<TransactionRecord> {
  const fingerprint = input.fingerprint?.trim() || null;
  if (fingerprint) {
    const existing = await db.get<{ id: string }>(
      'SELECT id FROM transactions WHERE fingerprint = ? AND deleted_at IS NULL',
      [fingerprint],
    );
    if (existing) {
      const duplicate = await getTransaction(db, existing.id);
      if (duplicate) {
        return duplicate;
      }
    }
  }

  const now = toLocalDateTime(new Date());
  const id = createUuid();
  const deviceId = await getDeviceId(db);
  const source = input.source ?? 'manual';
  await db.run(
    `INSERT INTO transactions (
       id, type, amount, currency, category_id, description, occurred_at, created_at, updated_at,
       deleted_at, revision, synced_revision, device_id, sync_status, source, fingerprint
     ) VALUES (?, ?, ?, 'VND', ?, ?, ?, ?, ?, NULL, 1, 0, ?, 'pending', ?, ?)`,
    [
      id,
      input.type,
      input.amount,
      input.categoryId,
      input.description.trim(),
      input.occurredAt,
      now,
      now,
      deviceId,
      source,
      fingerprint,
    ],
  );
  await noteLocalChange(db, 'transactions', id, 1, now);
  const created = await getTransaction(db, id);
  if (!created) {
    throw new Error('Không lưu được giao dịch.');
  }
  return created;
}

export async function updateTransaction(db: DatabaseClient, id: string, input: TransactionInput): Promise<void> {
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE transactions
     SET type = ?, amount = ?, category_id = ?, description = ?, occurred_at = ?, updated_at = ?,
         revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [input.type, input.amount, input.categoryId, input.description.trim(), input.occurredAt, now, deviceId, id],
  );
  const row = await db.get<{ revision: number }>('SELECT revision FROM transactions WHERE id = ? AND deleted_at IS NULL', [id]);
  if (row) {
    await noteLocalChange(db, 'transactions', id, row.revision, now);
  }
}

export async function deleteTransaction(db: DatabaseClient, id: string): Promise<void> {
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.transaction(async () => {
    await db.run('DELETE FROM attachments WHERE transaction_id = ?', [id]);
    await db.run(
      `UPDATE transactions
       SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [now, now, deviceId, id],
    );
  });
  const row = await db.get<{ revision: number }>('SELECT revision FROM transactions WHERE id = ?', [id]);
  if (row) {
    await noteLocalChange(db, 'transactions', id, row.revision, now);
  }
}

export async function getTransaction(db: DatabaseClient, id: string): Promise<TransactionListItem | null> {
  const row = await db.get<TransactionRow>(`${LIST_SELECT} AND t.id = ?`, [id]);
  return row ? mapTransaction(row) : null;
}

export async function listTransactions(db: DatabaseClient, query: TransactionQuery): Promise<TransactionListItem[]> {
  const { sql, params } = buildFilter(query);
  const rows = await db.all<TransactionRow>(
    `${LIST_SELECT} ${sql} ORDER BY t.occurred_at DESC, t.created_at DESC LIMIT ? OFFSET ?`,
    [...params, query.limit, query.offset],
  );
  return rows.map(mapTransaction);
}

export async function sumAmount(
  db: DatabaseClient,
  input: { type: TransactionType; start: string; end: string; categoryId?: string | null },
): Promise<number> {
  const row = await db.get<{ total: number | null }>(
    `SELECT SUM(amount) AS total
     FROM transactions
     WHERE type = ?
       AND occurred_at >= ?
       AND occurred_at < ?
       AND deleted_at IS NULL
       AND (? IS NULL OR category_id = ?)`,
    [input.type, input.start, `${input.end}T99`, input.categoryId ?? null, input.categoryId ?? null],
  );
  return row?.total ?? 0;
}

export async function sumByDay(
  db: DatabaseClient,
  input: { type: TransactionType; start: string; end: string },
): Promise<{ day: string; total: number }[]> {
  return db.all<{ day: string; total: number }>(
    `SELECT substr(occurred_at, 1, 10) AS day, SUM(amount) AS total
     FROM transactions
     WHERE type = ? AND occurred_at >= ? AND occurred_at < ? AND deleted_at IS NULL
     GROUP BY day
     ORDER BY day ASC`,
    [input.type, input.start, `${input.end}T99`],
  );
}

export async function sumByHour(
  db: DatabaseClient,
  input: { type: TransactionType; day: string },
): Promise<{ hour: string; total: number }[]> {
  return db.all<{ hour: string; total: number }>(
    `SELECT substr(occurred_at, 12, 2) AS hour, SUM(amount) AS total
     FROM transactions
     WHERE type = ? AND occurred_at >= ? AND occurred_at < ? AND deleted_at IS NULL
     GROUP BY hour`,
    [input.type, input.day, `${input.day}T99`],
  );
}

export async function sumByMonth(
  db: DatabaseClient,
  input: { type: TransactionType; year: number },
): Promise<{ month: string; total: number }[]> {
  return db.all<{ month: string; total: number }>(
    `SELECT substr(occurred_at, 6, 2) AS month, SUM(amount) AS total
     FROM transactions
     WHERE type = ? AND occurred_at >= ? AND occurred_at < ? AND deleted_at IS NULL
     GROUP BY month`,
    [input.type, `${input.year}-01-01`, `${input.year + 1}-01-01`],
  );
}

export async function sumByCategory(
  db: DatabaseClient,
  input: { type: TransactionType; start: string; end: string },
): Promise<{ categoryId: string; name: string; color: string; icon: string; total: number }[]> {
  return db.all(
    `SELECT c.id AS categoryId, c.name AS name, c.color AS color, c.icon AS icon, SUM(t.amount) AS total
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE t.type = ? AND t.occurred_at >= ? AND t.occurred_at < ? AND t.deleted_at IS NULL
     GROUP BY c.id
     ORDER BY total DESC`,
    [input.type, input.start, `${input.end}T99`],
  );
}

export async function countTransactions(
  db: DatabaseClient,
  input: { type: TransactionType; start: string; end: string },
): Promise<number> {
  const row = await db.get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM transactions
     WHERE type = ? AND occurred_at >= ? AND occurred_at < ? AND deleted_at IS NULL`,
    [input.type, input.start, `${input.end}T99`],
  );
  return row?.total ?? 0;
}

export async function listAllForExport(db: DatabaseClient): Promise<TransactionListItem[]> {
  const rows = await db.all<TransactionRow>(`${LIST_SELECT} ORDER BY t.occurred_at ASC`);
  return rows.map(mapTransaction);
}

export async function upsertImportedTransaction(
  db: DatabaseClient,
  input: TransactionInput & { id: string },
): Promise<void> {
  const existing = await db.get<{ id: string }>('SELECT id FROM transactions WHERE id = ?', [input.id]);
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  if (existing) {
    await db.run(
      `UPDATE transactions
       SET type = ?, amount = ?, category_id = ?, description = ?, occurred_at = ?, updated_at = ?,
           deleted_at = NULL, revision = revision + 1, sync_status = 'pending', device_id = ?
       WHERE id = ?`,
      [input.type, input.amount, input.categoryId, input.description, input.occurredAt, now, deviceId, input.id],
    );
  } else {
    await db.run(
      `INSERT INTO transactions (
         id, type, amount, currency, category_id, description, occurred_at, created_at, updated_at,
         deleted_at, revision, synced_revision, device_id, sync_status
       ) VALUES (?, ?, ?, 'VND', ?, ?, ?, ?, ?, NULL, 1, 0, ?, 'pending')`,
      [input.id, input.type, input.amount, input.categoryId, input.description, input.occurredAt, now, now, deviceId],
    );
  }
  const row = await db.get<{ revision: number }>('SELECT revision FROM transactions WHERE id = ?', [input.id]);
  await noteLocalChange(db, 'transactions', input.id, row?.revision ?? 1, now);
}

export async function clearUserData(db: DatabaseClient): Promise<string[]> {
  const files = await db.all<{ local_uri: string }>('SELECT local_uri FROM attachments');
  await db.transaction(async () => {
    await db.exec('DELETE FROM attachments');
    await db.exec('DELETE FROM transactions');
    await db.exec('DELETE FROM budgets');
    await db.exec('DELETE FROM sync_outbox');
    await db.exec('DELETE FROM sync_conflicts');
    await db.exec('DELETE FROM preferences');
    await db.exec('DELETE FROM categories WHERE is_default = 0');
  });
  return files.map((file) => file.local_uri);
}

const LIST_SELECT = `SELECT
  t.id, t.type, t.amount, t.currency, t.category_id, t.description, t.occurred_at, t.created_at, t.updated_at,
  c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
  (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = t.id) AS attachment_count
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
  WHERE t.deleted_at IS NULL`;

function buildFilter(query: TransactionQuery): { sql: string; params: Array<string | null> } {
  const clauses: string[] = [];
  const params: Array<string | null> = [];

  if (query.type) {
    clauses.push('t.type = ?');
    params.push(query.type);
  }
  if (query.categoryId) {
    clauses.push('t.category_id = ?');
    params.push(query.categoryId);
  }
  if (query.from) {
    clauses.push('t.occurred_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    clauses.push('t.occurred_at < ?');
    params.push(`${query.to}T99`);
  }
  if (query.search?.trim()) {
    clauses.push('(t.description LIKE ? OR c.name LIKE ?)');
    const term = `%${query.search.trim()}%`;
    params.push(term, term);
  }

  return {
    sql: clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '',
    params,
  };
}

function mapTransaction(row: TransactionRow): TransactionListItem {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    currency: 'VND',
    categoryId: row.category_id,
    description: row.description,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    categoryColor: row.category_color,
    attachmentCount: row.attachment_count,
  };
}

export async function addAttachment(
  db: DatabaseClient,
  input: { transactionId: string; localUri: string; mimeType: string },
): Promise<Attachment> {
  const id = createId();
  const createdAt = toLocalDateTime(new Date());
  await db.run(
    `INSERT INTO attachments (id, transaction_id, local_uri, mime_type, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, input.transactionId, input.localUri, input.mimeType, createdAt],
  );
  return { id, transactionId: input.transactionId, localUri: input.localUri, mimeType: input.mimeType, createdAt };
}

export async function listAttachments(db: DatabaseClient, transactionId: string): Promise<Attachment[]> {
  const rows = await db.all<{ id: string; transaction_id: string; local_uri: string; mime_type: string; created_at: string }>(
    'SELECT * FROM attachments WHERE transaction_id = ? ORDER BY created_at ASC',
    [transactionId],
  );
  return rows.map((row) => ({
    id: row.id,
    transactionId: row.transaction_id,
    localUri: row.local_uri,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  }));
}

export async function deleteAttachment(db: DatabaseClient, id: string): Promise<string | null> {
  const row = await db.get<{ local_uri: string }>('SELECT local_uri FROM attachments WHERE id = ?', [id]);
  await db.run('DELETE FROM attachments WHERE id = ?', [id]);
  return row?.local_uri ?? null;
}
