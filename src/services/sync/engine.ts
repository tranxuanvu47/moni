import type { DatabaseClient } from '@/src/database/client';
import { decodeCursor, encodeCursor, type PullCursor } from '@/src/services/sync/cursor';
import { getDeviceId } from '@/src/services/sync/device';
import { CLOUD_MAX_PAGES, CLOUD_PAGE_SIZE, CLOUD_SCHEMA_VERSION, CURSOR_KEYS, metaKeys, type SyncEntityName } from '@/src/services/sync/constants';
import { acknowledgeRecord, applyRemoteRecord, countConflicts, listLocalRecords, saveConflict } from '@/src/services/sync/local-store';
import { mergeDelta, uploadsFrom } from '@/src/services/sync/merge';
import { blockedOutboxIds, clearOutbox, countPending, countPendingTransactions, deferOutbox, ensurePendingQueued } from '@/src/services/sync/outbox';
import { backoffDelayMs } from '@/src/services/sync/sanitize';
import type { CanonicalRecord, CloudStore, SyncCycleResult } from '@/src/services/sync/types';
import { getPreference, setMetaPreference } from '@/src/services/sync/meta';

const APPLY_ORDER: SyncEntityName[] = ['categories', 'settings', 'accounts', 'budgets', 'transactions'];

export async function runSyncCycle(input: {
  db: DatabaseClient;
  store: CloudStore;
  online: boolean;
  now: string;
  force?: boolean;
  random?: () => number;
}): Promise<SyncCycleResult> {
  const pending = await countPending(input.db);
  const enabled = await getPreference(input.db, metaKeys.enabled);
  const linkedUid = await getPreference(input.db, metaKeys.linkedUid);
  const account = await input.store.getAccount();
  if (enabled !== '1' || !account || !linkedUid) {
    return { outcome: 'disabled' };
  }
  if (linkedUid !== account.uid) {
    const message = 'Tài khoản đăng nhập không khớp dữ liệu đã gắn trên máy này.';
    await setMetaPreference(input.db, metaKeys.lastError, message);
    return { outcome: 'error', message, pending };
  }
  if (!input.online) {
    return { outcome: 'offline', pending };
  }

  const nextAttempt = await getPreference(input.db, metaKeys.nextAttempt);
  if (!input.force && nextAttempt && nextAttempt > input.now) {
    return { outcome: 'waiting', pending, nextAttemptAt: nextAttempt };
  }

  await ensurePendingQueued(input.db, input.now);
  const deviceId = await getDeviceId(input.db);

  try {
    const remoteSchema = await input.store.readRemoteSchema(account.uid);
    if (remoteSchema !== null && remoteSchema > CLOUD_SCHEMA_VERSION) {
      const message = 'Dữ liệu trên đám mây dùng phiên bản mới hơn ứng dụng. Hãy cập nhật app trước khi đồng bộ.';
      await setMetaPreference(input.db, metaKeys.lastError, message);
      return { outcome: 'error', message, pending };
    }

    let skipped = 0;
    let more = false;
    const remote: CanonicalRecord[] = [];
    const cursors = new Map<SyncEntityName, PullCursor | null>();
    for (const entity of APPLY_ORDER) {
      let cursor = decodeCursor(await getPreference(input.db, CURSOR_KEYS[entity]));
      let pages = 0;
      while (pages < CLOUD_MAX_PAGES) {
        const page = await input.store.pull(account.uid, entity, cursor, CLOUD_PAGE_SIZE);
        remote.push(...page.records);
        skipped += page.skipped;
        if (page.nextCursor) {
          cursor = page.nextCursor;
        }
        pages += 1;
        if (!page.hasMore) {
          break;
        }
        if (pages >= CLOUD_MAX_PAGES) {
          more = true;
        }
      }
      cursors.set(entity, cursor);
    }

    const local = await listLocalRecords(input.db);
    const blocked = await blockedOutboxIds(input.db, input.now, input.force === true);
    const plan = mergeDelta(local, remote);
    const push = uploadsFrom(local, plan, blocked);

    let pulled = 0;
    await input.db.transaction(async () => {
      for (const entity of APPLY_ORDER) {
        for (const record of plan.apply.filter((row) => row.entity === entity)) {
          const result = await applyRemoteRecord(input.db, record);
          if (result === 'applied') {
            pulled += 1;
          } else {
            skipped += 1;
          }
        }
      }
      for (const ack of plan.ack) {
        await acknowledgeRecord(input.db, ack.entity, ack.id, ack.revision);
      }
      for (const conflict of plan.conflicts) {
        await saveConflict(input.db, conflict.local, conflict.remote, input.now);
      }
      for (const entity of APPLY_ORDER) {
        const cursor = cursors.get(entity) ?? null;
        await setMetaPreference(input.db, CURSOR_KEYS[entity], encodeCursor(cursor));
      }
    });

    let pushConflicts = 0;
    try {
      const pushed = await input.store.upsert(account.uid, push, deviceId);
      pushConflicts = pushed.conflicts.length;
      for (const conflict of pushed.conflicts) {
        await saveConflict(input.db, conflict.local, conflict.remote, input.now);
      }
      const finished = [...pushed.written, ...pushed.acknowledged];
      await clearOutbox(
        input.db,
        finished.map((row) => ({ entity: row.entity, id: row.id })),
      );
      for (const row of finished) {
        await acknowledgeRecord(input.db, row.entity, row.id, row.revision);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không đồng bộ được lên đám mây.';
      const failCount = Number((await getPreference(input.db, metaKeys.failCount)) ?? '0') + 1;
      const delay = backoffDelayMs(failCount - 1, input.random);
      const next = addSeconds(input.now, Math.ceil(delay / 1000));
      await deferOutbox(
        input.db,
        push.map((row) => ({ entity: row.entity, id: row.id })),
        input.now,
        message,
        next,
      );
      await setMetaPreference(input.db, metaKeys.failCount, String(failCount));
      await setMetaPreference(input.db, metaKeys.nextAttempt, next);
      await setMetaPreference(input.db, metaKeys.lastError, message);
      return { outcome: 'error', message, pending: await countPending(input.db) };
    }

    const notes = [
      skipped > 0 ? `Bỏ qua ${skipped} bản ghi không hợp lệ hoặc bị trùng.` : '',
      more ? 'Còn dữ liệu trên đám mây. Lần đồng bộ sau sẽ tải tiếp.' : '',
    ].filter(Boolean);
    await setMetaPreference(input.db, metaKeys.lastSuccess, input.now);
    await setMetaPreference(input.db, metaKeys.lastError, '');
    await setMetaPreference(input.db, metaKeys.lastWarning, notes.join(' '));
    await setMetaPreference(input.db, metaKeys.failCount, '0');
    await setMetaPreference(input.db, metaKeys.nextAttempt, '');
    await setMetaPreference(input.db, metaKeys.email, account.email);

    return {
      outcome: 'ok',
      pushed: push.length,
      pulled,
      conflicts: plan.conflicts.length + pushConflicts,
      pending: await countPending(input.db),
      skipped,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Đồng bộ thất bại.';
    await setMetaPreference(input.db, metaKeys.lastError, message);
    return { outcome: 'error', message, pending: await countPending(input.db) };
  }
}

function addSeconds(localDateTime: string, seconds: number): string {
  const [date, time] = localDateTime.split('T');
  if (!date || !time) {
    return localDateTime;
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const value = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, (second ?? 0) + seconds);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

export async function readSyncStatus(db: DatabaseClient): Promise<{
  enabled: boolean;
  email: string | null;
  linkedUid: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastWarning: string | null;
  pendingTransactions: number;
  conflicts: number;
}> {
  const [enabled, email, linkedUid, lastSuccessAt, lastError, lastWarning, pendingTransactions, conflicts] = await Promise.all([
    getPreference(db, metaKeys.enabled),
    getPreference(db, metaKeys.email),
    getPreference(db, metaKeys.linkedUid),
    getPreference(db, metaKeys.lastSuccess),
    getPreference(db, metaKeys.lastError),
    getPreference(db, metaKeys.lastWarning),
    countPendingTransactions(db),
    countConflicts(db),
  ]);
  return {
    enabled: enabled === '1',
    email,
    linkedUid,
    lastSuccessAt,
    lastError: lastError || null,
    lastWarning: lastWarning || null,
    pendingTransactions,
    conflicts,
  };
}
