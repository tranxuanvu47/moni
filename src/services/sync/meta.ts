import type { DatabaseClient } from '@/src/database/client';

export async function getPreference(db: DatabaseClient, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM preferences WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setMetaPreference(db: DatabaseClient, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO preferences (key, value, updated_at, revision, synced_revision, device_id, sync_status, deleted_at)
     VALUES (?, ?, '1970-01-01T00:00:00', 1, 1, '', 'synced', NULL)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, sync_status = 'synced', deleted_at = NULL`,
    [key, value],
  );
}
