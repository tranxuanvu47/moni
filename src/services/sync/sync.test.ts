import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { createMemoryClient } from '@/src/database/memory-client';
import { migrate } from '@/src/database/migrate';
import { DEFAULT_CATEGORIES } from '@/src/features/categories/defaults';
import { createTransaction, getTransaction, listTransactions, sumAmount, updateTransaction, deleteTransaction } from '@/src/database/repositories/transactions';
import type { DatabaseClient } from '@/src/database/client';
import { encodeRecord, parseSnapshot } from '@/src/services/sync/codec';
import { decodeCursor, encodeCursor, isAfterCursor } from '@/src/services/sync/cursor';
import { fromCloudDocument, reconcileRemote, toCloudDocument } from '@/src/services/sync/firestore-doc';
import { HEADERS, metaKeys, SHEET_NAMES } from '@/src/services/sync/constants';
import { runSyncCycle } from '@/src/services/sync/engine';
import { decideAccountLink, isOwner } from '@/src/services/sync/link';
import { listLocalRecords, resolveConflict } from '@/src/services/sync/local-store';
import { MemoryCloudStore } from '@/src/services/sync/memory-cloud';
import { setMetaPreference } from '@/src/services/sync/meta';
import { applySheetRestore, previewSheets } from '@/src/services/sync/restore';
import { backoffDelayMs, withBackoff } from '@/src/services/sync/sanitize';
import { importSheetSnapshots } from '@/src/services/sync/sheets-import';
import { SyncHttpError, type CanonicalRecord, type CloudStore, type SheetSnapshot } from '@/src/services/sync/types';

const NOW = '2026-10-03T22:00:00';

async function setup(linked = true): Promise<DatabaseClient> {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = createMemoryClient(sqlite);
  await migrate(db);
  if (linked) {
    await setMetaPreference(db, metaKeys.enabled, '1');
    await setMetaPreference(db, metaKeys.linkedUid, 'user-1');
  }
  return db;
}

function sync(db: DatabaseClient, store: CloudStore, online = true) {
  return runSyncCycle({ db, store, online, now: NOW, force: true, random: () => 0 });
}

describe('đồng bộ Firestore', () => {
  it('lùi thời gian chờ theo cấp số nhân và dừng ở 60 giây', async () => {
    expect(backoffDelayMs(0, () => 0)).toBe(1000);
    expect(backoffDelayMs(1, () => 0)).toBe(2000);
    expect(backoffDelayMs(8, () => 0)).toBe(60_000);
    const delays: number[] = [];
    let calls = 0;
    const result = await withBackoff({
      maxAttempts: 3,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0,
      shouldRetry: () => true,
      run: async () => {
        calls += 1;
        if (calls < 3) {
          throw new SyncHttpError('quota', 429, null);
        }
        return 'ok';
      },
    });
    expect(result).toBe('ok');
    expect(delays).toEqual([1000, 2000]);
  });

  it('vẫn lưu giao dịch khi offline và không tạo dòng trùng sau khi có mạng', async () => {
    const db = await setup();
    const store = new MemoryCloudStore();
    const created = await createTransaction(db, {
      type: 'expense',
      amount: 35000,
      categoryId: 'cat_food',
      description: 'Ăn sáng',
      occurredAt: '2026-10-03T08:15:00',
    });

    const offline = await sync(db, store, false);
    expect(offline.outcome).toBe('offline');
    expect(store.records('transactions')).toHaveLength(0);
    expect(await listTransactions(db, { limit: 20, offset: 0 })).toHaveLength(1);

    store.failWrites = 1;
    const failed = await sync(db, store, true);
    expect(failed.outcome).toBe('error');
    expect(await getTransaction(db, created.id)).not.toBeNull();

    await sync(db, store, true);
    expect(store.records('transactions')).toHaveLength(1);
    await sync(db, store, true);
    expect(store.records('transactions')).toHaveLength(1);
    expect(store.records('categories')).toHaveLength(DEFAULT_CATEGORIES.length);
  });

  it('không tải dữ liệu máy lên tài khoản Firebase khác', async () => {
    const db = await setup();
    await createTransaction(db, {
      type: 'expense',
      amount: 35000,
      categoryId: 'cat_food',
      description: 'Ăn sáng',
      occurredAt: '2026-10-03T08:15:00',
    });
    const store = new MemoryCloudStore();
    store.account = { uid: 'user-2', email: 'other@gmail.com' };
    const result = await sync(db, store, true);
    expect(result.outcome).toBe('error');
    expect(store.countAll()).toBe(0);
    expect(await listTransactions(db, { limit: 20, offset: 0 })).toHaveLength(1);
  });

  it('đưa thay đổi sang máy khác, kể cả xóa, và không ghi đè khi xung đột', async () => {
    const phone = await setup();
    const tablet = await setup();
    const store = new MemoryCloudStore();
    const created = await createTransaction(phone, {
      type: 'expense',
      amount: 35000,
      categoryId: 'cat_food',
      description: 'Ăn sáng',
      occurredAt: '2026-10-03T08:15:00',
    });
    await sync(phone, store);
    await sync(tablet, store);
    expect((await getTransaction(tablet, created.id))?.amount).toBe(35000);

    await updateTransaction(tablet, created.id, {
      type: 'expense',
      amount: 45000,
      categoryId: 'cat_drink',
      description: 'Cà phê',
      occurredAt: '2026-10-03T08:20:00',
    });
    await sync(tablet, store);
    await sync(phone, store);
    expect((await getTransaction(phone, created.id))?.amount).toBe(45000);

    await updateTransaction(phone, created.id, {
      type: 'expense',
      amount: 111000,
      categoryId: 'cat_food',
      description: 'Ăn sáng',
      occurredAt: '2026-10-03T08:15:00',
    });
    await updateTransaction(tablet, created.id, {
      type: 'expense',
      amount: 222000,
      categoryId: 'cat_food',
      description: 'Ăn sáng',
      occurredAt: '2026-10-03T08:15:00',
    });
    await sync(phone, store);
    const conflicted = await sync(tablet, store);
    expect(conflicted.outcome).toBe('ok');
    if (conflicted.outcome === 'ok') {
      expect(conflicted.conflicts).toBeGreaterThanOrEqual(1);
    }
    expect((await getTransaction(tablet, created.id))?.amount).toBe(222000);
    expect(store.records('transactions').find((row) => row.id === created.id)?.fields.amount).toBe('111000');

    await resolveConflict(tablet, 'transactions', created.id, 'local', NOW);
    await sync(tablet, store);
    await sync(phone, store);
    expect((await getTransaction(phone, created.id))?.amount).toBe(222000);

    await deleteTransaction(phone, created.id);
    await sync(phone, store);
    await sync(tablet, store);
    expect(await listTransactions(tablet, { limit: 20, offset: 0 })).toHaveLength(0);
    expect(await listTransactions(phone, { limit: 20, offset: 0 })).toHaveLength(0);
  });

  it('giữ mô tả công thức và bỏ qua giao dịch ngân hàng trùng fingerprint', async () => {
    const phone = await setup();
    const tablet = await setup();
    const store = new MemoryCloudStore();
    const created = await createTransaction(phone, {
      type: 'expense',
      amount: 10000,
      categoryId: 'cat_other',
      description: '=HYPERLINK("http://evil")',
      occurredAt: '2026-10-03T09:00:00',
    });
    await phone.run('UPDATE transactions SET fingerprint = ? WHERE id = ?', ['bank_abc', created.id]);
    await sync(phone, store);
    const cloud = store.records('transactions').find((row) => row.id === created.id);
    expect(cloud?.fields.description).toBe('=HYPERLINK("http://evil")');
    expect(cloud?.fields.description.startsWith("'")).toBe(false);
    await sync(tablet, store);
    expect((await getTransaction(tablet, created.id))?.description).toBe('=HYPERLINK("http://evil")');

    store.seed('user-1', {
      entity: 'transactions',
      id: 'tx_dup',
      revision: 1,
      syncedRevision: 1,
      syncStatus: 'synced',
      deviceId: 'other',
      updatedAt: '2099-01-01T00:00:00',
      fields: {
        type: 'expense',
        amount: '10000',
        currency: 'VND',
        category_id: 'cat_other',
        description: 'Trùng ngân hàng',
        occurred_at: '2099-01-01T00:00:00',
        created_at: '2099-01-01T00:00:00',
        deleted_at: '',
        source: 'bank_notification',
        fingerprint: 'bank_abc',
        account_id: '',
        transfer_account_id: '',
      },
    });
    const pulled = await sync(tablet, store);
    expect(pulled.outcome).toBe('ok');
    if (pulled.outcome === 'ok') {
      expect(pulled.skipped).toBeGreaterThan(0);
    }
    expect(await getTransaction(tablet, 'tx_dup')).toBeNull();
    expect(await listTransactions(tablet, { limit: 20, offset: 0 })).toHaveLength(1);
  });

  it('không tính chuyển khoản vào tổng chi', async () => {
    const db = await setup(false);
    await createTransaction(db, {
      type: 'expense',
      amount: 35000,
      categoryId: 'cat_food',
      description: 'Ăn sáng',
      occurredAt: '2026-10-04T08:00:00',
    });
    await createTransaction(db, {
      type: 'transfer',
      amount: 2000000,
      categoryId: 'cat_other',
      description: 'VCB sang MB',
      occurredAt: '2026-10-04T08:05:00',
    });
    expect(await sumAmount(db, { type: 'expense', start: '2026-10-01', end: '2026-10-31' })).toBe(35000);
  });

  it('nhập Google Sheets theo ID cũ và không xóa giao dịch chỉ có trên máy', async () => {
    const db = await setup(false);
    await createTransaction(db, {
      type: 'expense',
      amount: 999,
      categoryId: 'cat_other',
      description: 'Chỉ có trên máy',
      occurredAt: '2026-10-03T10:00:00',
    });
    const record: CanonicalRecord = {
      entity: 'transactions',
      id: 'tx_sheet_1',
      revision: 2,
      syncedRevision: 2,
      syncStatus: 'synced',
      deviceId: 'sheet',
      updatedAt: '2026-10-01T10:00:00',
      fields: {
        type: 'expense',
        amount: '150000',
        currency: 'VND',
        category_id: 'cat_food',
        description: 'Grab',
        occurred_at: '2026-10-01T10:00:00',
        created_at: '2026-10-01T10:00:00',
        deleted_at: '',
      },
    };
    const encoded = encodeRecord(record, 'sheet');
    expect(encoded.values[5].startsWith("'")).toBe(false);
    const sheets = {
      [SHEET_NAMES.metadata]: { header: [...HEADERS[SHEET_NAMES.metadata]], rows: [['schema_version', '1']] },
      [SHEET_NAMES.transactions]: { header: [...HEADERS[SHEET_NAMES.transactions]], rows: [encoded.values] },
    };
    const first = await importSheetSnapshots(db, sheets);
    expect(first.inserted).toBe(1);
    expect(first.sheet).toEqual({ count: 1, income: 0, expense: 150000 });
    const second = await importSheetSnapshots(db, sheets);
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(1);
    const listed = await listTransactions(db, { limit: 20, offset: 0 });
    expect(listed.map((item) => item.description).sort()).toEqual(['Chỉ có trên máy', 'Grab']);
  });

  it('khôi phục bản Sheets vẫn đọc lại mô tả công thức', async () => {
    const phone = await setup(false);
    const created = await createTransaction(phone, {
      type: 'expense',
      amount: 10000,
      categoryId: 'cat_other',
      description: '=HYPERLINK("http://evil")',
      occurredAt: '2026-10-03T09:00:00',
    });
    const local = await listLocalRecords(phone);
    const tx = local.find((row) => row.id === created.id);
    expect(tx).toBeTruthy();
    const encoded = encodeRecord(tx ?? local[0], 'device');
    expect(encoded.values[5].startsWith("'")).toBe(true);
    const collapsed = parseSnapshot('transactions', {
      header: [...HEADERS[SHEET_NAMES.transactions]],
      rows: [encoded.values, encoded.values],
    });
    expect(collapsed.records).toHaveLength(1);
    expect(collapsed.skipped).toBe(1);
    const sheets: Partial<Record<string, SheetSnapshot>> = {
      [SHEET_NAMES.metadata]: { header: [...HEADERS[SHEET_NAMES.metadata]], rows: [['schema_version', '1']] },
      [SHEET_NAMES.transactions]: { header: [...HEADERS[SHEET_NAMES.transactions]], rows: [encoded.values, ['bad_row', 'expense', 'abc']] },
    };
    expect(previewSheets(sheets).skipped).toBeGreaterThan(0);
    const tablet = await setup(false);
    await createTransaction(tablet, {
      type: 'expense',
      amount: 999,
      categoryId: 'cat_other',
      description: 'Chỉ có trên máy',
      occurredAt: '2026-10-03T10:00:00',
    });
    const restored = await applySheetRestore(tablet, sheets);
    const listed = await listTransactions(tablet, { limit: 20, offset: 0 });
    expect(listed.map((item) => item.description)).toEqual(['=HYPERLINK("http://evil")']);
    expect(restored.preview.transactions).toBe(1);
    expect(await getTransaction(tablet, 'bad_row')).toBeNull();
  });
});

describe('quyết định gắn tài khoản và schema Firestore', () => {
  it('không gắn dữ liệu cũ vào tài khoản lạ và chặn tài khoản khác', () => {
    const counts = { transactions: 2, customCategories: 0, budgets: 0 };
    expect(decideAccountLink(null, 'user-1', counts)).toBe('confirm');
    expect(decideAccountLink(null, 'user-1', { transactions: 0, customCategories: 0, budgets: 0 })).toBe('resume');
    expect(decideAccountLink('user-1', 'user-1', counts)).toBe('resume');
    expect(decideAccountLink('user-1', 'user-2', counts)).toBe('blocked');
    expect(isOwner(null, 'user-1')).toBe(false);
    expect(isOwner('user-2', 'user-1')).toBe(false);
    expect(isOwner('user-1', 'user-1')).toBe(true);
  });

  it('kéo theo mốc updatedAt và id, bỏ qua bản đã thấy', () => {
    const cursor = { updatedAt: '2026-10-04T08:00:00', revision: 2, id: 'b' };
    expect(encodeCursor(decodeCursor(encodeCursor(cursor)))).toBe(encodeCursor(cursor));
    expect(isAfterCursor({ updatedAt: '2026-10-04T08:00:00', revision: 2, id: 'b' }, cursor)).toBe(false);
    expect(isAfterCursor({ updatedAt: '2026-10-04T08:00:00', revision: 3, id: 'b' }, cursor)).toBe(true);
    expect(isAfterCursor({ updatedAt: '2026-10-04T08:00:00', revision: 2, id: 'c' }, cursor)).toBe(true);
    expect(isAfterCursor({ updatedAt: '2026-10-04T07:00:00', revision: 9, id: 'z' }, cursor)).toBe(false);
  });

  it('từ chối số tiền lẻ và ghi đè khi bản remote đã đổi', () => {
    const local: CanonicalRecord = {
      entity: 'transactions',
      id: 'tx_1',
      revision: 2,
      syncedRevision: 1,
      syncStatus: 'pending',
      deviceId: 'android',
      updatedAt: '2026-10-04T08:00:00',
      fields: {
        type: 'expense',
        amount: '150000',
        currency: 'VND',
        category_id: 'cat_transport',
        description: 'Grab',
        occurred_at: '2026-10-04T08:00:00',
        created_at: '2026-10-04T08:00:00',
        deleted_at: '',
        source: 'manual',
        fingerprint: '',
        account_id: '',
        transfer_account_id: '',
      },
    };
    const document = toCloudDocument(local, 'android');
    expect(document.amount).toBe(150000);
    expect(fromCloudDocument('transactions', 'tx_1', document)?.fields.description).toBe('Grab');
    expect(fromCloudDocument('transactions', 'tx_1', { ...document, amount: 150000.5 })).toBeNull();
    expect(fromCloudDocument('transactions', 'other', document)).toBeNull();
    const remote = fromCloudDocument('transactions', 'tx_1', { ...document, revision: 4, amount: 180000 });
    expect(reconcileRemote(local, remote)).toBe('conflict');
    expect(reconcileRemote(local, null)).toBe('write');
    expect(reconcileRemote(local, fromCloudDocument('transactions', 'tx_1', { ...document, revision: 1, amount: 90000 }))).toBe('write');
  });

  it('rules chỉ cho chủ tài khoản và không mở if true', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).toContain('request.auth.uid == userId');
    expect(rules).not.toContain('if true');
    expect(rules).toContain('allow delete: if false');
    expect(rules).toContain('hasOnly');
    for (const name of ['transactions', 'categories', 'budgets', 'settings', 'accounts']) {
      expect(rules).toContain(name);
    }
  });
});
