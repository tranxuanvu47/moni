import type { DatabaseClient } from '@/src/database/client';
import { SYNCED_PREFERENCE_KEYS } from '@/src/services/sync/constants';
import { getDeviceId } from '@/src/services/sync/device';
import { noteLocalChange } from '@/src/services/sync/outbox';
import { toLocalDateTime } from '@/src/utils/dates';

export const preferenceKeys = {
  reminderEnabled: 'reminder_enabled',
  reminderHour: 'reminder_hour',
  reminderMinute: 'reminder_minute',
  weeklyRecapEnabled: 'weekly_recap_enabled',
  budgetAlertEnabled: 'budget_alert_enabled',
  insightCache: 'insight_cache',
  insightCacheKey: 'insight_cache_key',
  lastBudgetAlert: 'last_budget_alert',
  bankNotificationsEnabled: 'bank_notifications_enabled',
} as const;

export async function getPreference(db: DatabaseClient, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM preferences WHERE key = ? AND deleted_at IS NULL', [key]);
  return row?.value ?? null;
}

export async function setPreference(db: DatabaseClient, key: string, value: string): Promise<void> {
  if (!(SYNCED_PREFERENCE_KEYS as readonly string[]).includes(key)) {
    await db.run(
      `INSERT INTO preferences (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
    return;
  }

  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  const current = await db.get<{ revision: number; synced_revision: number }>(
    'SELECT revision, synced_revision FROM preferences WHERE key = ?',
    [key],
  );
  const revision = (current?.revision ?? 0) + 1;
  await db.run(
    `INSERT INTO preferences (key, value, updated_at, revision, synced_revision, device_id, sync_status, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at,
       revision = excluded.revision,
       device_id = excluded.device_id,
       sync_status = 'pending',
       deleted_at = NULL`,
    [key, value, now, revision, current?.synced_revision ?? 0, deviceId],
  );
  await noteLocalChange(db, 'settings', key, revision, now);
}

export async function deletePreference(db: DatabaseClient, key: string): Promise<void> {
  await db.run('DELETE FROM preferences WHERE key = ?', [key]);
}
