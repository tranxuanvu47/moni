import type { DatabaseClient } from '@/src/database/client';
import { createTransaction } from '@/src/database/repositories/transactions';
import { getDeviceId } from '@/src/services/sync/device';
import type {
  RecurrenceFrequency,
  RecurringMode,
  RecurringRule,
  TransactionRecord,
  TransactionType,
} from '@/src/types/finance';
import { daysInMonth, formatIsoDate, parseIsoDate, toLocalDateTime } from '@/src/utils/dates';
import { createUuid } from '@/src/utils/id';

interface RuleRow {
  id: string;
  type: TransactionType;
  amount: number;
  category_id: string;
  account_id: string;
  transfer_account_id: string | null;
  transfer_fee: number;
  description: string;
  start_date: string;
  end_date: string | null;
  frequency: RecurrenceFrequency;
  recurrence_interval: number;
  mode: RecurringMode;
  timezone: string;
  anchor_day: number;
  next_occurrence_date: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface RecurringRuleInput {
  type: TransactionType;
  amount: number;
  categoryId: string;
  accountId: string;
  transferAccountId?: string | null;
  transferFee?: number;
  description?: string;
  startDate: string;
  endDate?: string | null;
  frequency: RecurrenceFrequency;
  interval?: number;
  mode: RecurringMode;
  timezone: string;
  enabled?: boolean;
}

// Recurring rules carry revision metadata but remain local-only until the sync codec adds this entity.

export async function listRecurringRules(
  db: DatabaseClient,
  options: { includeDisabled?: boolean } = {},
): Promise<RecurringRule[]> {
  const rows = await db.all<RuleRow>(
    `SELECT * FROM recurring_rules
     WHERE deleted_at IS NULL ${options.includeDisabled ? '' : 'AND enabled = 1'}
     ORDER BY next_occurrence_date ASC, created_at ASC`,
  );
  return rows.map(mapRule);
}

export async function getRecurringRule(db: DatabaseClient, id: string): Promise<RecurringRule | null> {
  const row = await db.get<RuleRow>('SELECT * FROM recurring_rules WHERE id = ? AND deleted_at IS NULL', [id]);
  return row ? mapRule(row) : null;
}

export async function createRecurringRule(db: DatabaseClient, input: RecurringRuleInput): Promise<RecurringRule> {
  await validateRule(db, input);
  const id = createUuid();
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  const anchorDay = parseIsoDate(input.startDate).day;
  await db.run(
    `INSERT INTO recurring_rules (
       id, type, amount, category_id, account_id, transfer_account_id, transfer_fee, description,
       start_date, end_date, frequency, recurrence_interval, mode, timezone, anchor_day,
       next_occurrence_date, enabled, created_at, updated_at, deleted_at,
       revision, synced_revision, device_id, sync_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, ?, 'pending')`,
    [
      id,
      input.type,
      input.amount,
      input.categoryId,
      input.accountId,
      input.transferAccountId ?? null,
      input.type === 'transfer' ? input.transferFee ?? 0 : 0,
      input.description?.trim() ?? '',
      input.startDate,
      input.endDate ?? null,
      input.frequency,
      input.interval ?? 1,
      input.mode,
      input.timezone,
      anchorDay,
      input.startDate,
      input.enabled === false ? 0 : 1,
      now,
      now,
      deviceId,
    ],
  );
  const created = await getRecurringRule(db, id);
  if (!created) {
    throw new Error('Không tạo được giao dịch định kỳ.');
  }
  return created;
}

export async function updateRecurringRule(db: DatabaseClient, id: string, input: RecurringRuleInput): Promise<void> {
  await validateRule(db, input);
  const current = await getRecurringRule(db, id);
  if (!current) {
    throw new Error('Không tìm thấy giao dịch định kỳ.');
  }
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  const scheduleChanged =
    current.startDate !== input.startDate ||
    current.frequency !== input.frequency ||
    current.interval !== (input.interval ?? 1);
  const anchorDay = parseIsoDate(input.startDate).day;
  await db.run(
    `UPDATE recurring_rules
     SET type = ?, amount = ?, category_id = ?, account_id = ?, transfer_account_id = ?, transfer_fee = ?,
         description = ?, start_date = ?, end_date = ?, frequency = ?, recurrence_interval = ?, mode = ?,
         timezone = ?, anchor_day = ?, next_occurrence_date = ?, enabled = ?, updated_at = ?,
         revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      input.type,
      input.amount,
      input.categoryId,
      input.accountId,
      input.transferAccountId ?? null,
      input.type === 'transfer' ? input.transferFee ?? 0 : 0,
      input.description?.trim() ?? '',
      input.startDate,
      input.endDate ?? null,
      input.frequency,
      input.interval ?? 1,
      input.mode,
      input.timezone,
      anchorDay,
      scheduleChanged ? input.startDate : current.nextOccurrenceDate,
      input.enabled === false ? 0 : 1,
      now,
      deviceId,
      id,
    ],
  );
}

export async function setRecurringRuleEnabled(db: DatabaseClient, id: string, enabled: boolean): Promise<void> {
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE recurring_rules
     SET enabled = ?, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [enabled ? 1 : 0, now, deviceId, id],
  );
}

export async function deleteRecurringRule(db: DatabaseClient, id: string): Promise<void> {
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE recurring_rules
     SET deleted_at = ?, enabled = 0, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [now, now, deviceId, id],
  );
}

export async function listDueRecurringReminders(db: DatabaseClient, throughDate: string): Promise<RecurringRule[]> {
  const rows = await db.all<RuleRow>(
    `SELECT * FROM recurring_rules
     WHERE deleted_at IS NULL AND enabled = 1 AND mode = 'reminder'
       AND next_occurrence_date <= ? AND (end_date IS NULL OR next_occurrence_date <= end_date)
     ORDER BY next_occurrence_date ASC`,
    [throughDate],
  );
  return rows.map(mapRule);
}

export async function advanceRecurringReminder(
  db: DatabaseClient,
  id: string,
  handledOccurrenceDate: string,
): Promise<string> {
  const rule = await getRecurringRule(db, id);
  if (!rule || rule.mode !== 'reminder') {
    throw new Error('Không tìm thấy lời nhắc định kỳ.');
  }
  if (rule.nextOccurrenceDate !== handledOccurrenceDate) {
    return rule.nextOccurrenceDate;
  }
  const next = nextOccurrence(handledOccurrenceDate, rule.frequency, rule.interval, rule.anchorDay);
  const finished = Boolean(rule.endDate && next > rule.endDate);
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE recurring_rules
     SET next_occurrence_date = ?, enabled = ?, updated_at = ?, revision = revision + 1,
         sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [next, finished ? 0 : 1, now, deviceId, id],
  );
  return next;
}

export async function materializeRecurringTransactions(
  db: DatabaseClient,
  throughDate: string,
): Promise<TransactionRecord[]> {
  const rules = (await listRecurringRules(db)).filter(
    (rule) => rule.mode === 'automatic' && rule.nextOccurrenceDate <= throughDate,
  );
  const created: TransactionRecord[] = [];
  for (const rule of rules) {
    let occurrence = rule.nextOccurrenceDate;
    let iterations = 0;
    while (occurrence <= throughDate && (!rule.endDate || occurrence <= rule.endDate)) {
      if (iterations >= 500) {
        throw new Error('Quy tắc định kỳ có quá nhiều kỳ chưa xử lý.');
      }
      created.push(
        await createTransaction(db, {
          type: rule.type,
          amount: rule.amount,
          categoryId: rule.categoryId,
          accountId: rule.accountId,
          transferAccountId: rule.transferAccountId,
          transferFee: rule.transferFee,
          description: rule.description,
          occurredAt: `${occurrence}T00:00:00`,
          source: 'manual',
          recurringRuleId: rule.id,
          occurrenceKey: `${rule.id}:${occurrence}`,
        }),
      );
      occurrence = nextOccurrence(occurrence, rule.frequency, rule.interval, rule.anchorDay);
      iterations += 1;
    }
    const finished = Boolean(rule.endDate && occurrence > rule.endDate);
    const deviceId = await getDeviceId(db);
    await db.run(
      `UPDATE recurring_rules
       SET next_occurrence_date = ?, enabled = ?, updated_at = ?, revision = revision + 1,
           sync_status = 'pending', device_id = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [occurrence, finished ? 0 : 1, toLocalDateTime(new Date()), deviceId, rule.id],
    );
  }
  return created;
}

export function nextOccurrence(
  current: string,
  frequency: RecurrenceFrequency,
  interval: number,
  anchorDay = parseIsoDate(current).day,
): string {
  const date = parseIsoDate(current);
  if (frequency === 'daily' || frequency === 'weekly') {
    const native = new Date(date.year, date.month - 1, date.day + interval * (frequency === 'weekly' ? 7 : 1));
    return formatIsoDate({ year: native.getFullYear(), month: native.getMonth() + 1, day: native.getDate() });
  }
  const monthDelta = frequency === 'yearly' ? interval * 12 : interval;
  const target = new Date(date.year, date.month - 1 + monthDelta, 1);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  return formatIsoDate({ year, month, day: Math.min(anchorDay, daysInMonth(year, month)) });
}

async function validateRule(db: DatabaseClient, input: RecurringRuleInput): Promise<void> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error('Số tiền định kỳ phải là số nguyên VND lớn hơn 0.');
  }
  if (!Number.isInteger(input.interval ?? 1) || (input.interval ?? 1) <= 0) {
    throw new Error('Chu kỳ lặp không hợp lệ.');
  }
  if (input.endDate && input.endDate < input.startDate) {
    throw new Error('Ngày kết thúc phải sau ngày bắt đầu.');
  }
  if (!input.timezone.trim()) {
    throw new Error('Múi giờ không được để trống.');
  }
  if (input.type === 'transfer') {
    if (!input.transferAccountId || input.transferAccountId === input.accountId) {
      throw new Error('Chuyển khoản định kỳ cần hai tài khoản khác nhau.');
    }
  }
  for (const accountId of [input.accountId, input.transferAccountId].filter(Boolean) as string[]) {
    const account = await db.get<{ id: string }>('SELECT id FROM accounts WHERE id = ? AND deleted_at IS NULL', [accountId]);
    if (!account) {
      throw new Error('Tài khoản định kỳ không tồn tại.');
    }
  }
}

function mapRule(row: RuleRow): RecurringRule {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    categoryId: row.category_id,
    accountId: row.account_id,
    transferAccountId: row.transfer_account_id,
    transferFee: row.transfer_fee,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    frequency: row.frequency,
    interval: row.recurrence_interval,
    mode: row.mode,
    timezone: row.timezone,
    anchorDay: row.anchor_day,
    nextOccurrenceDate: row.next_occurrence_date,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
