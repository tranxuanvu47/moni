import type { DatabaseClient } from '@/src/database/client';
import { SYNCED_PREFERENCE_KEYS, type SyncEntityName } from '@/src/services/sync/constants';
import { clearOutbox, noteLocalChange } from '@/src/services/sync/outbox';
import type { CanonicalRecord, StoredConflict } from '@/src/services/sync/types';

interface SyncRow {
  id: string;
  revision: number;
  synced_revision: number;
  sync_status: 'pending' | 'synced' | 'conflict';
  device_id: string;
  updated_at: string;
  deleted_at: string | null;
  type?: string;
  amount?: number;
  currency?: string;
  category_id?: string | null;
  description?: string;
  occurred_at?: string;
  created_at?: string;
  source?: string | null;
  fingerprint?: string | null;
  account_id?: string | null;
  transfer_account_id?: string | null;
  name?: string;
  icon?: string;
  color?: string;
  is_default?: number;
  sort_order?: number;
  period?: string;
  effective_date?: string;
  value?: string;
}

const preferenceList = SYNCED_PREFERENCE_KEYS.map(() => '?').join(', ');

export async function listLocalRecords(db: DatabaseClient): Promise<CanonicalRecord[]> {
  const transactions = await db.all<SyncRow>(
    `SELECT id, type, amount, currency, category_id, description, occurred_at, created_at, updated_at, deleted_at,
            revision, synced_revision, device_id, sync_status, source, fingerprint, account_id, transfer_account_id
     FROM transactions`,
  );
  const categories = await db.all<SyncRow>(
    `SELECT id, name, icon, color, type, is_default, sort_order, created_at, updated_at, deleted_at,
            revision, synced_revision, device_id, sync_status
     FROM categories`,
  );
  const budgets = await db.all<SyncRow>(
    `SELECT id, category_id, amount, period, effective_date, created_at, updated_at, deleted_at,
            revision, synced_revision, device_id, sync_status
     FROM budgets`,
  );
  const settings = await db.all<SyncRow>(
    `SELECT key AS id, value, updated_at, deleted_at, revision, synced_revision, device_id, sync_status
     FROM preferences
     WHERE key IN (${preferenceList})`,
    [...SYNCED_PREFERENCE_KEYS],
  );

  return [
    ...transactions.map((row) =>
      toRecord('transactions', row, {
        type: row.type ?? '',
        amount: String(row.amount ?? ''),
        currency: row.currency ?? '',
        category_id: row.category_id ?? '',
        description: row.description ?? '',
        occurred_at: row.occurred_at ?? '',
        created_at: row.created_at ?? '',
        deleted_at: row.deleted_at ?? '',
        source: row.source || 'manual',
        fingerprint: row.fingerprint ?? '',
        account_id: row.account_id ?? '',
        transfer_account_id: row.transfer_account_id ?? '',
      }),
    ),
    ...categories.map((row) =>
      toRecord('categories', row, {
        name: row.name ?? '',
        icon: row.icon ?? '',
        color: row.color ?? '',
        type: row.type ?? '',
        is_default: row.is_default === 1 ? '1' : '0',
        sort_order: String(row.sort_order ?? 0),
        created_at: row.created_at ?? '',
        deleted_at: row.deleted_at ?? '',
      }),
    ),
    ...budgets.map((row) =>
      toRecord('budgets', row, {
        category_id: row.category_id ?? '',
        amount: String(row.amount ?? ''),
        period: row.period ?? '',
        effective_date: row.effective_date ?? '',
        created_at: row.created_at ?? '',
        deleted_at: row.deleted_at ?? '',
      }),
    ),
    ...settings.map((row) =>
      toRecord('settings', row, {
        value: row.value ?? '',
        deleted_at: row.deleted_at ?? '',
      }),
    ),
  ];
}

export async function applyRemoteRecord(db: DatabaseClient, record: CanonicalRecord): Promise<'applied' | 'skipped'> {
  if (record.entity === 'categories' && record.fields.is_default === '1' && record.fields.deleted_at) {
    return 'skipped';
  }
  if (record.entity === 'categories') {
    const existing = await db.get<{ is_default: number }>('SELECT is_default FROM categories WHERE id = ?', [record.id]);
    if (existing?.is_default === 1 && record.fields.deleted_at) {
      return 'skipped';
    }
  }
  if (record.entity === 'transactions') {
    const category = await db.get<{ id: string }>('SELECT id FROM categories WHERE id = ?', [record.fields.category_id]);
    if (!category) {
      return 'skipped';
    }
    const fingerprint = emptyToNull(record.fields.fingerprint);
    if (fingerprint) {
      const duplicate = await db.get<{ id: string }>(
        `SELECT id FROM transactions
         WHERE fingerprint = ? AND id != ? AND deleted_at IS NULL`,
        [fingerprint, record.id],
      );
      if (duplicate) {
        return 'skipped';
      }
    }
  }

  if (record.entity === 'transactions') {
    await db.run(
      `INSERT INTO transactions (
         id, type, amount, currency, category_id, description, occurred_at, created_at, updated_at, deleted_at,
         revision, synced_revision, device_id, sync_status, source, fingerprint, account_id, transfer_account_id
       ) VALUES (?, ?, ?, 'VND', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         amount = excluded.amount,
         category_id = excluded.category_id,
         description = excluded.description,
         occurred_at = excluded.occurred_at,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         revision = excluded.revision,
         synced_revision = excluded.synced_revision,
         device_id = excluded.device_id,
         sync_status = 'synced',
         source = excluded.source,
         fingerprint = excluded.fingerprint,
         account_id = excluded.account_id,
         transfer_account_id = excluded.transfer_account_id`,
      [
        record.id,
        record.fields.type,
        Number(record.fields.amount),
        record.fields.category_id,
        record.fields.description,
        record.fields.occurred_at,
        record.fields.created_at,
        record.updatedAt,
        emptyToNull(record.fields.deleted_at),
        record.revision,
        record.revision,
        record.deviceId,
        record.fields.source || 'manual',
        emptyToNull(record.fields.fingerprint),
        emptyToNull(record.fields.account_id),
        emptyToNull(record.fields.transfer_account_id),
      ],
    );
  } else if (record.entity === 'categories') {
    await db.run(
      `INSERT INTO categories (
         id, name, icon, color, type, is_default, sort_order, created_at, updated_at, deleted_at,
         revision, synced_revision, device_id, sync_status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         icon = excluded.icon,
         color = excluded.color,
         type = excluded.type,
         is_default = excluded.is_default,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         revision = excluded.revision,
         synced_revision = excluded.synced_revision,
         device_id = excluded.device_id,
         sync_status = 'synced'`,
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
        emptyToNull(record.fields.deleted_at),
        record.revision,
        record.revision,
        record.deviceId,
      ],
    );
  } else if (record.entity === 'budgets') {
    await db.run(
      `INSERT INTO budgets (
         id, category_id, amount, period, effective_date, created_at, updated_at, deleted_at,
         revision, synced_revision, device_id, sync_status
       ) VALUES (?, ?, ?, 'month', ?, ?, ?, ?, ?, ?, ?, 'synced')
       ON CONFLICT(id) DO UPDATE SET
         category_id = excluded.category_id,
         amount = excluded.amount,
         effective_date = excluded.effective_date,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         revision = excluded.revision,
         synced_revision = excluded.synced_revision,
         device_id = excluded.device_id,
         sync_status = 'synced'`,
      [
        record.id,
        emptyToNull(record.fields.category_id),
        Number(record.fields.amount),
        record.fields.effective_date,
        record.fields.created_at,
        record.updatedAt,
        emptyToNull(record.fields.deleted_at),
        record.revision,
        record.revision,
        record.deviceId,
      ],
    );
  } else {
    await db.run(
      `INSERT INTO preferences (key, value, updated_at, deleted_at, revision, synced_revision, device_id, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         revision = excluded.revision,
         synced_revision = excluded.synced_revision,
         device_id = excluded.device_id,
         sync_status = 'synced'`,
      [
        record.id,
        record.fields.value,
        record.updatedAt,
        emptyToNull(record.fields.deleted_at),
        record.revision,
        record.revision,
        record.deviceId,
      ],
    );
  }

  await clearOutbox(db, [{ entity: record.entity, id: record.id }]);
  await db.run('DELETE FROM sync_conflicts WHERE entity = ? AND entity_id = ?', [record.entity, record.id]);
  return 'applied';
}

export async function acknowledgeRecord(db: DatabaseClient, entity: SyncEntityName, id: string, revision: number): Promise<void> {
  const sql = {
    transactions: 'UPDATE transactions SET sync_status = \'synced\', revision = ?, synced_revision = ? WHERE id = ?',
    categories: 'UPDATE categories SET sync_status = \'synced\', revision = ?, synced_revision = ? WHERE id = ?',
    budgets: 'UPDATE budgets SET sync_status = \'synced\', revision = ?, synced_revision = ? WHERE id = ?',
    settings: 'UPDATE preferences SET sync_status = \'synced\', revision = ?, synced_revision = ? WHERE key = ?',
  }[entity];
  await db.run(sql, [revision, revision, id]);
  await clearOutbox(db, [{ entity, id }]);
  await db.run('DELETE FROM sync_conflicts WHERE entity = ? AND entity_id = ?', [entity, id]);
}

export async function saveConflict(
  db: DatabaseClient,
  local: CanonicalRecord,
  remote: CanonicalRecord | null,
  detectedAt: string,
): Promise<void> {
  await db.run(
    `INSERT INTO sync_conflicts (entity, entity_id, local_payload, remote_payload, detected_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(entity, entity_id) DO UPDATE SET
       local_payload = excluded.local_payload,
       remote_payload = excluded.remote_payload,
       detected_at = excluded.detected_at`,
    [local.entity, local.id, JSON.stringify(local), remote ? JSON.stringify(remote) : '', detectedAt],
  );
  const sql = {
    transactions: "UPDATE transactions SET sync_status = 'conflict' WHERE id = ?",
    categories: "UPDATE categories SET sync_status = 'conflict' WHERE id = ?",
    budgets: "UPDATE budgets SET sync_status = 'conflict' WHERE id = ?",
    settings: "UPDATE preferences SET sync_status = 'conflict' WHERE key = ?",
  }[local.entity];
  await db.run(sql, [local.id]);
  await clearOutbox(db, [{ entity: local.entity, id: local.id }]);
}

export async function listConflicts(db: DatabaseClient): Promise<StoredConflict[]> {
  const rows = await db.all<{ entity: SyncEntityName; entity_id: string; local_payload: string; remote_payload: string; detected_at: string }>(
    'SELECT entity, entity_id, local_payload, remote_payload, detected_at FROM sync_conflicts ORDER BY detected_at ASC',
  );
  return rows.flatMap((row) => {
    const local = parsePayload(row.local_payload);
    if (!local) {
      return [];
    }
    const remote = row.remote_payload ? parsePayload(row.remote_payload) : null;
    return [{ entity: row.entity, id: row.entity_id, local, remote, detectedAt: row.detected_at }];
  });
}

export async function countConflicts(db: DatabaseClient): Promise<number> {
  const row = await db.get<{ total: number }>('SELECT COUNT(*) AS total FROM sync_conflicts');
  return row?.total ?? 0;
}

export async function resolveConflict(
  db: DatabaseClient,
  entity: SyncEntityName,
  id: string,
  choice: 'local' | 'remote',
  now: string,
): Promise<void> {
  const row = await db.get<{ local_payload: string; remote_payload: string }>(
    'SELECT local_payload, remote_payload FROM sync_conflicts WHERE entity = ? AND entity_id = ?',
    [entity, id],
  );
  if (!row) {
    return;
  }
  const local = parsePayload(row.local_payload);
  const remote = row.remote_payload ? parsePayload(row.remote_payload) : null;
  if (!local) {
    await db.run('DELETE FROM sync_conflicts WHERE entity = ? AND entity_id = ?', [entity, id]);
    return;
  }

  if (choice === 'remote') {
    if (!remote) {
      await removeLocalRecord(db, local);
      await db.run('DELETE FROM sync_conflicts WHERE entity = ? AND entity_id = ?', [entity, id]);
      return;
    }
    await applyRemoteRecord(db, remote);
    return;
  }

  const nextRevision = Math.max(local.revision, remote?.revision ?? local.revision) + 1;
  const syncedRevision = remote?.revision ?? local.syncedRevision;
  await stampPending(db, local, nextRevision, syncedRevision, now);
  await noteLocalChange(db, entity, id, nextRevision, now);
}

async function removeLocalRecord(db: DatabaseClient, local: CanonicalRecord): Promise<void> {
  if (local.entity === 'transactions') {
    await db.run('DELETE FROM attachments WHERE transaction_id = ?', [local.id]);
    await db.run('DELETE FROM transactions WHERE id = ?', [local.id]);
  } else if (local.entity === 'categories') {
    if (local.fields.is_default === '1') {
      await acknowledgeRecord(db, local.entity, local.id, local.revision);
      return;
    }
    await db.run('DELETE FROM categories WHERE id = ?', [local.id]);
  } else if (local.entity === 'budgets') {
    await db.run('DELETE FROM budgets WHERE id = ?', [local.id]);
  } else {
    await db.run('DELETE FROM preferences WHERE key = ?', [local.id]);
  }
  await clearOutbox(db, [{ entity: local.entity, id: local.id }]);
}

async function stampPending(
  db: DatabaseClient,
  local: CanonicalRecord,
  revision: number,
  syncedRevision: number,
  now: string,
): Promise<void> {
  if (local.entity === 'transactions') {
    await db.run(
      `UPDATE transactions
       SET revision = ?, synced_revision = ?, sync_status = 'pending', updated_at = ?, device_id = ?
       WHERE id = ?`,
      [revision, syncedRevision, now, local.deviceId, local.id],
    );
    return;
  }
  if (local.entity === 'categories') {
    await db.run(
      `UPDATE categories
       SET revision = ?, synced_revision = ?, sync_status = 'pending', updated_at = ?, device_id = ?
       WHERE id = ?`,
      [revision, syncedRevision, now, local.deviceId, local.id],
    );
    return;
  }
  if (local.entity === 'budgets') {
    await db.run(
      `UPDATE budgets
       SET revision = ?, synced_revision = ?, sync_status = 'pending', updated_at = ?, device_id = ?
       WHERE id = ?`,
      [revision, syncedRevision, now, local.deviceId, local.id],
    );
    return;
  }
  await db.run(
    `UPDATE preferences
     SET revision = ?, synced_revision = ?, sync_status = 'pending', updated_at = ?, device_id = ?
     WHERE key = ?`,
    [revision, syncedRevision, now, local.deviceId, local.id],
  );
}

function toRecord(entity: SyncEntityName, row: SyncRow, fields: Record<string, string>): CanonicalRecord {
  return {
    entity,
    id: row.id,
    revision: row.revision,
    syncedRevision: row.synced_revision,
    syncStatus: row.sync_status,
    deviceId: row.device_id,
    updatedAt: row.updated_at || '1970-01-01T00:00:00',
    fields,
  };
}

function emptyToNull(value: string | undefined): string | null {
  return value ? value : null;
}

function parsePayload(value: string): CanonicalRecord | null {
  try {
    const parsed = JSON.parse(value) as CanonicalRecord;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.revision !== 'number' || !parsed.fields) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
