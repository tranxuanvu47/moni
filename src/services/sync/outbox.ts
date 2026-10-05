import type { DatabaseClient } from '@/src/database/client';
import type { SyncEntityName } from '@/src/services/sync/constants';
import { requestSyncSoon } from '@/src/services/sync/schedule';

export async function noteLocalChange(
  db: DatabaseClient,
  entity: SyncEntityName,
  id: string,
  revision: number,
  now: string,
): Promise<void> {
  const conflict = await db.get<{ remote_payload: string }>(
    'SELECT remote_payload FROM sync_conflicts WHERE entity = ? AND entity_id = ?',
    [entity, id],
  );
  if (conflict?.remote_payload) {
    const remoteRevision = readRemoteRevision(conflict.remote_payload);
    if (remoteRevision) {
      const table = entity === 'settings' ? 'preferences' : entity;
      const idColumn = entity === 'settings' ? 'key' : 'id';
      await db.run(`UPDATE ${table} SET synced_revision = ? WHERE ${idColumn} = ? AND synced_revision < ?`, [
        remoteRevision,
        id,
        remoteRevision,
      ]);
    }
  }

  await db.run(
    `INSERT INTO sync_outbox (entity, entity_id, revision, enqueued_at, attempts, next_attempt_at, last_error)
     VALUES (?, ?, ?, ?, 0, NULL, NULL)
     ON CONFLICT(entity, entity_id) DO UPDATE SET
       revision = excluded.revision,
       enqueued_at = excluded.enqueued_at,
       attempts = 0,
       next_attempt_at = NULL,
       last_error = NULL`,
    [entity, id, revision, now],
  );
  await db.run('DELETE FROM sync_conflicts WHERE entity = ? AND entity_id = ?', [entity, id]);
  requestSyncSoon();
}

function readRemoteRevision(payload: string): number | null {
  try {
    const parsed = JSON.parse(payload) as { revision?: unknown };
    return typeof parsed.revision === 'number' ? parsed.revision : null;
  } catch {
    return null;
  }
}

export async function ensurePendingQueued(db: DatabaseClient, now: string): Promise<void> {
  const tables: Array<{ entity: SyncEntityName; table: string; idColumn: string; where: string }> = [
    { entity: 'transactions', table: 'transactions', idColumn: 'id', where: "sync_status = 'pending'" },
    { entity: 'categories', table: 'categories', idColumn: 'id', where: "sync_status = 'pending'" },
    { entity: 'accounts', table: 'accounts', idColumn: 'id', where: "sync_status = 'pending'" },
    { entity: 'budgets', table: 'budgets', idColumn: 'id', where: "sync_status = 'pending'" },
    {
      entity: 'settings',
      table: 'preferences',
      idColumn: 'key',
      where: "sync_status = 'pending' AND key IN ('reminder_enabled', 'reminder_hour', 'reminder_minute', 'weekly_recap_enabled', 'budget_alert_enabled')",
    },
  ];

  for (const table of tables) {
    await db.run(
      `INSERT INTO sync_outbox (entity, entity_id, revision, enqueued_at, attempts, next_attempt_at, last_error)
       SELECT ?, ${table.idColumn}, revision, ?, 0, NULL, NULL
       FROM ${table.table}
       WHERE ${table.where}
       ON CONFLICT(entity, entity_id) DO NOTHING`,
      [table.entity, now],
    );
  }
}

export async function countPendingTransactions(db: DatabaseClient): Promise<number> {
  const row = await db.get<{ total: number }>("SELECT COUNT(*) AS total FROM transactions WHERE sync_status = 'pending'");
  return row?.total ?? 0;
}

export async function countPending(db: DatabaseClient): Promise<number> {
  const row = await db.get<{ total: number }>(
    `SELECT
       (SELECT COUNT(*) FROM transactions WHERE sync_status = 'pending')
       + (SELECT COUNT(*) FROM categories WHERE sync_status = 'pending')
       + (SELECT COUNT(*) FROM accounts WHERE sync_status = 'pending')
       + (SELECT COUNT(*) FROM budgets WHERE sync_status = 'pending')
       + (SELECT COUNT(*) FROM preferences WHERE sync_status = 'pending' AND key IN ('reminder_enabled', 'reminder_hour', 'reminder_minute', 'weekly_recap_enabled', 'budget_alert_enabled'))
       AS total`,
  );
  return row?.total ?? 0;
}

export async function deferOutbox(
  db: DatabaseClient,
  rows: Array<{ entity: SyncEntityName; id: string }>,
  now: string,
  message: string,
  nextAttemptAt: string,
): Promise<void> {
  for (const row of rows) {
    await db.run(
      `UPDATE sync_outbox
       SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, enqueued_at = ?
       WHERE entity = ? AND entity_id = ?`,
      [message, nextAttemptAt, now, row.entity, row.id],
    );
  }
}

export async function clearOutbox(db: DatabaseClient, rows: Array<{ entity: SyncEntityName; id: string }>): Promise<void> {
  for (const row of rows) {
    await db.run('DELETE FROM sync_outbox WHERE entity = ? AND entity_id = ?', [row.entity, row.id]);
  }
}

export async function blockedOutboxIds(db: DatabaseClient, now: string, force: boolean): Promise<Set<string>> {
  const rows = await db.all<{ entity: string; entity_id: string; attempts: number; next_attempt_at: string | null }>(
    'SELECT entity, entity_id, attempts, next_attempt_at FROM sync_outbox',
  );
  const blocked = new Set<string>();
  for (const row of rows) {
    const waiting = !force && row.next_attempt_at !== null && row.next_attempt_at > now;
    const exhausted = row.attempts >= 8 && !force;
    if (waiting || exhausted) {
      blocked.add(`${row.entity}:${row.entity_id}`);
    }
  }
  return blocked;
}
