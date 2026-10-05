import type { DatabaseClient } from '@/src/database/client';
import { getDeviceId } from '@/src/services/sync/device';
import { noteLocalChange } from '@/src/services/sync/outbox';
import type { Account, AccountAdjustment, AccountType, AccountWithBalance } from '@/src/types/finance';
import { DEFAULT_ACCOUNT_ID } from '@/src/types/finance';
import { toLocalDateTime } from '@/src/utils/dates';
import { createUuid } from '@/src/utils/id';

interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  bank_code: string | null;
  masked_identifier: string | null;
  currency: 'VND';
  opening_balance: number;
  opening_balance_date: string;
  archived_at: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface AdjustmentRow {
  id: string;
  account_id: string;
  amount: number;
  reason: string;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

export interface AccountInput {
  name: string;
  type: AccountType;
  bankCode?: string | null;
  maskedIdentifier?: string | null;
  openingBalance?: number;
  openingBalanceDate: string;
}

export function listAccounts(
  db: DatabaseClient,
  options: { includeArchived?: boolean; withBalances: true; asOf?: string },
): Promise<AccountWithBalance[]>;
export function listAccounts(
  db: DatabaseClient,
  options?: { includeArchived?: boolean; withBalances?: false; asOf?: string },
): Promise<Account[]>;
export async function listAccounts(
  db: DatabaseClient,
  options: { includeArchived?: boolean; withBalances?: boolean; asOf?: string } = {},
): Promise<(Account | AccountWithBalance)[]> {
  const rows = await db.all<AccountRow>(
    `SELECT * FROM accounts
     WHERE deleted_at IS NULL ${options.includeArchived ? '' : 'AND archived_at IS NULL'}
     ORDER BY display_order ASC, created_at ASC`,
  );
  const accounts = rows.map(mapAccount);
  if (!options.withBalances) {
    return accounts;
  }
  return Promise.all(
    accounts.map(async (account) => ({
      ...account,
      balance: await getAccountBalance(db, account.id, options.asOf),
    })),
  );
}

export async function getAccount(db: DatabaseClient, id: string): Promise<Account | null> {
  const row = await db.get<AccountRow>('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL', [id]);
  return row ? mapAccount(row) : null;
}

export async function getDefaultAccount(db: DatabaseClient): Promise<Account> {
  const account = await getAccount(db, DEFAULT_ACCOUNT_ID);
  if (!account) {
    throw new Error('Tài khoản tiền mặt mặc định chưa sẵn sàng.');
  }
  return account;
}

export async function createAccount(db: DatabaseClient, input: AccountInput): Promise<Account> {
  validateAccountInput(input);
  const id = createUuid();
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  const order = await db.get<{ max_order: number | null }>(
    'SELECT MAX(display_order) AS max_order FROM accounts WHERE deleted_at IS NULL',
  );
  await db.run(
    `INSERT INTO accounts (
       id, name, type, bank_code, masked_identifier, currency, opening_balance, opening_balance_date,
       archived_at, display_order, created_at, updated_at, deleted_at, revision, synced_revision, device_id, sync_status
     ) VALUES (?, ?, ?, ?, ?, 'VND', ?, ?, NULL, ?, ?, ?, NULL, 1, 0, ?, 'pending')`,
    [
      id,
      input.name.trim(),
      input.type,
      nullable(input.bankCode),
      nullable(input.maskedIdentifier),
      input.openingBalance ?? 0,
      input.openingBalanceDate,
      (order?.max_order ?? -1) + 1,
      now,
      now,
      deviceId,
    ],
  );
  await noteLocalChange(db, 'accounts', id, 1, now);
  const created = await getAccount(db, id);
  if (!created) {
    throw new Error('Không tạo được tài khoản.');
  }
  return created;
}

export async function updateAccount(db: DatabaseClient, id: string, input: AccountInput): Promise<void> {
  validateAccountInput(input);
  const current = await getAccount(db, id);
  if (!current) {
    throw new Error('Không tìm thấy tài khoản.');
  }
  const openingChanged =
    current.openingBalance !== (input.openingBalance ?? 0) || current.openingBalanceDate !== input.openingBalanceDate;
  if (openingChanged) {
    const activity = await db.get<{ total: number }>(
      `SELECT
         (SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL AND (account_id = ? OR transfer_account_id = ?))
         + (SELECT COUNT(*) FROM account_adjustments WHERE deleted_at IS NULL AND account_id = ?)
         AS total`,
      [id, id, id],
    );
    if ((activity?.total ?? 0) > 0) {
      throw new Error('Tài khoản đã có lịch sử. Hãy dùng đối soát thay vì sửa số dư đầu kỳ.');
    }
  }
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE accounts
     SET name = ?, type = ?, bank_code = ?, masked_identifier = ?, opening_balance = ?, opening_balance_date = ?,
         updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      input.name.trim(),
      input.type,
      nullable(input.bankCode),
      nullable(input.maskedIdentifier),
      input.openingBalance ?? 0,
      input.openingBalanceDate,
      now,
      deviceId,
      id,
    ],
  );
  const updated = await db.get<{ revision: number }>('SELECT revision FROM accounts WHERE id = ?', [id]);
  if (updated) {
    await noteLocalChange(db, 'accounts', id, updated.revision, now);
  }
}

export async function setAccountArchived(db: DatabaseClient, id: string, archived: boolean): Promise<void> {
  if (archived) {
    const active = await db.get<{ total: number }>(
      'SELECT COUNT(*) AS total FROM accounts WHERE archived_at IS NULL AND deleted_at IS NULL',
    );
    if ((active?.total ?? 0) <= 1) {
      throw new Error('Cần giữ lại ít nhất một tài khoản đang hoạt động.');
    }
  }
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE accounts
     SET archived_at = ?, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [archived ? now : null, now, deviceId, id],
  );
  const updated = await db.get<{ revision: number }>('SELECT revision FROM accounts WHERE id = ?', [id]);
  if (updated) {
    await noteLocalChange(db, 'accounts', id, updated.revision, now);
  }
}

export async function reorderAccounts(db: DatabaseClient, orderedIds: string[]): Promise<void> {
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error('Danh sách tài khoản sắp xếp bị trùng.');
  }
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.transaction(async () => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await db.run(
        `UPDATE accounts
         SET display_order = ?, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [index, now, deviceId, orderedIds[index]],
      );
      const updated = await db.get<{ revision: number }>('SELECT revision FROM accounts WHERE id = ?', [orderedIds[index]]);
      if (updated && orderedIds[index]) {
        await noteLocalChange(db, 'accounts', orderedIds[index], updated.revision, now);
      }
    }
  });
}

export async function getAccountBalance(db: DatabaseClient, accountId: string, asOf?: string): Promise<number> {
  const account = await getAccount(db, accountId);
  if (!account) {
    throw new Error('Không tìm thấy tài khoản.');
  }
  const upper = asOf ? endOfInput(asOf) : null;
  const transaction = await db.get<{ total: number | null }>(
    `SELECT SUM(
       CASE
         WHEN type = 'income' AND account_id = ? THEN amount
         WHEN type = 'expense' AND account_id = ? THEN -amount
         WHEN type = 'transfer' AND account_id = ? THEN -(amount + transfer_fee)
         WHEN type = 'transfer' AND transfer_account_id = ? THEN amount
         ELSE 0
       END
     ) AS total
     FROM transactions
     WHERE deleted_at IS NULL
       AND occurred_at >= ?
       AND (? IS NULL OR occurred_at <= ?)
       AND (account_id = ? OR transfer_account_id = ?)`,
    [accountId, accountId, accountId, accountId, account.openingBalanceDate, upper, upper, accountId, accountId],
  );
  const adjustments = await db.get<{ total: number | null }>(
    `SELECT SUM(amount) AS total
     FROM account_adjustments
     WHERE account_id = ? AND deleted_at IS NULL AND occurred_at >= ? AND (? IS NULL OR occurred_at <= ?)`,
    [accountId, account.openingBalanceDate, upper, upper],
  );
  return account.openingBalance + (transaction?.total ?? 0) + (adjustments?.total ?? 0);
}

export async function listAccountAdjustments(db: DatabaseClient, accountId: string): Promise<AccountAdjustment[]> {
  const rows = await db.all<AdjustmentRow>(
    `SELECT * FROM account_adjustments
     WHERE account_id = ? AND deleted_at IS NULL
     ORDER BY occurred_at DESC, created_at DESC`,
    [accountId],
  );
  return rows.map(mapAdjustment);
}

export async function reconcileAccount(
  db: DatabaseClient,
  input: { accountId: string; actualBalance: number; occurredAt: string; reason?: string },
): Promise<AccountAdjustment | null> {
  if (!Number.isSafeInteger(input.actualBalance)) {
    throw new Error('Số dư đối soát phải là số nguyên VND.');
  }
  const current = await getAccountBalance(db, input.accountId, input.occurredAt);
  const difference = input.actualBalance - current;
  if (difference === 0) {
    return null;
  }
  const id = createUuid();
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  const reason = input.reason?.trim() || 'Điều chỉnh sau đối soát số dư';
  await db.run(
    `INSERT INTO account_adjustments (
       id, account_id, amount, reason, occurred_at, created_at, updated_at, deleted_at,
       revision, synced_revision, device_id, sync_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, ?, 'pending')`,
    [id, input.accountId, difference, reason, input.occurredAt, now, now, deviceId],
  );
  const row = await db.get<AdjustmentRow>('SELECT * FROM account_adjustments WHERE id = ?', [id]);
  if (!row) {
    throw new Error('Không lưu được điều chỉnh số dư.');
  }
  return mapAdjustment(row);
}

function validateAccountInput(input: AccountInput): void {
  if (!input.name.trim()) {
    throw new Error('Tên tài khoản không được để trống.');
  }
  if (!Number.isSafeInteger(input.openingBalance ?? 0)) {
    throw new Error('Số dư đầu kỳ phải là số nguyên VND.');
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(input.openingBalanceDate)) {
    throw new Error('Ngày số dư đầu kỳ không hợp lệ.');
  }
}

function nullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function endOfInput(value: string): string {
  return value.includes('T') ? value : `${value}T99:99:99`;
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    bankCode: row.bank_code,
    maskedIdentifier: row.masked_identifier,
    currency: 'VND',
    openingBalance: row.opening_balance,
    openingBalanceDate: row.opening_balance_date,
    archivedAt: row.archived_at,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAdjustment(row: AdjustmentRow): AccountAdjustment {
  return {
    id: row.id,
    accountId: row.account_id,
    amount: row.amount,
    reason: row.reason,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
