import type { DatabaseClient } from '@/src/database/client';
import { metaKeys } from '@/src/services/sync/constants';
import { createUuid } from '@/src/utils/id';
import { toLocalDateTime } from '@/src/utils/dates';

export async function getDeviceId(db: DatabaseClient): Promise<string> {
  const existing = await db.get<{ value: string }>('SELECT value FROM preferences WHERE key = ?', [metaKeys.deviceId]);
  if (existing?.value) {
    return existing.value;
  }
  const id = createUuid();
  const now = toLocalDateTime(new Date());
  await db.run(
    `INSERT INTO preferences (key, value, updated_at, revision, synced_revision, device_id, sync_status, deleted_at)
     VALUES (?, ?, ?, 1, 1, ?, 'synced', NULL)`,
    [metaKeys.deviceId, id, now, id],
  );
  return id;
}
