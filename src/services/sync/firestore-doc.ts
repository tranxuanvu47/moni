import { businessEqual } from '@/src/services/sync/codec';
import { nextUpdatedAt } from '@/src/services/sync/cursor';
import {
  CLOUD_SCHEMA_VERSION,
  SYNCED_PREFERENCE_KEYS,
  TRANSACTION_SOURCES,
  type SyncEntityName,
} from '@/src/services/sync/constants';
import type { CanonicalRecord } from '@/src/services/sync/types';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_AMOUNT = 1_000_000_000_000;

export type CloudFields = Record<string, unknown>;

export function assertReadableSchema(data: CloudFields): void {
  if (typeof data.schemaVersion === 'number' && data.schemaVersion > CLOUD_SCHEMA_VERSION) {
    throw new Error('Dữ liệu trên đám mây dùng phiên bản mới hơn ứng dụng. Hãy cập nhật app trước khi đồng bộ.');
  }
}

export function toCloudDocument(record: CanonicalRecord, deviceId: string): CloudFields {
  const writer = record.deviceId.trim() || deviceId;
  if (record.entity === 'transactions') {
    return {
      id: record.id,
      type: record.fields.type,
      amount: Number(record.fields.amount),
      currency: 'VND',
      categoryId: record.fields.category_id,
      description: String(record.fields.description ?? '').slice(0, 500),
      occurredAt: record.fields.occurred_at,
      createdAt: record.fields.created_at,
      updatedAt: record.updatedAt,
      deletedAt: record.fields.deleted_at || null,
      deleted: Boolean(record.fields.deleted_at),
      revision: record.revision,
      deviceId: writer,
      schemaVersion: CLOUD_SCHEMA_VERSION,
      source: sanitizeTransactionSource(record.fields.source),
      fingerprint: sanitizeFingerprint(record.fields.fingerprint),
      accountId: sanitizeOptionalId(record.fields.account_id),
      transferAccountId: sanitizeOptionalId(record.fields.transfer_account_id),
      transferFee: Number(record.fields.transfer_fee ?? '0'),
      recurringRuleId: sanitizeOptionalId(record.fields.recurring_rule_id),
      occurrenceKey: sanitizeOccurrenceKey(record.fields.occurrence_key),
    };
  }
  if (record.entity === 'categories') {
    return {
      id: record.id,
      name: record.fields.name ?? '',
      icon: record.fields.icon ?? '',
      color: record.fields.color ?? '',
      type: record.fields.type,
      isDefault: record.fields.is_default === '1',
      sortOrder: Number(record.fields.sort_order ?? '0'),
      createdAt: record.fields.created_at,
      updatedAt: record.updatedAt,
      deletedAt: record.fields.deleted_at || null,
      deleted: Boolean(record.fields.deleted_at),
      revision: record.revision,
      deviceId: writer,
      schemaVersion: CLOUD_SCHEMA_VERSION,
    };
  }
  if (record.entity === 'budgets') {
    return {
      id: record.id,
      categoryId: record.fields.category_id || null,
      amount: Number(record.fields.amount),
      period: 'month',
      effectiveDate: record.fields.effective_date,
      createdAt: record.fields.created_at,
      updatedAt: record.updatedAt,
      deletedAt: record.fields.deleted_at || null,
      deleted: Boolean(record.fields.deleted_at),
      revision: record.revision,
      deviceId: writer,
      schemaVersion: CLOUD_SCHEMA_VERSION,
      warningThreshold1: Number(record.fields.warning_threshold_bps ?? '8000'),
      warningThreshold2: Number(record.fields.limit_threshold_bps ?? '10000'),
    };
  }
  if (record.entity === 'accounts') {
    return {
      id: record.id,
      name: record.fields.name ?? '',
      type: record.fields.type,
      bankCode: record.fields.bank_code || null,
      maskedIdentifier: record.fields.masked_identifier || null,
      currency: 'VND',
      openingBalance: Number(record.fields.opening_balance ?? '0'),
      openingBalanceDate: record.fields.opening_balance_date,
      archivedAt: record.fields.archived_at || null,
      displayOrder: Number(record.fields.display_order ?? '0'),
      createdAt: record.fields.created_at,
      updatedAt: record.updatedAt,
      deletedAt: record.fields.deleted_at || null,
      deleted: Boolean(record.fields.deleted_at),
      revision: record.revision,
      deviceId: writer,
      schemaVersion: CLOUD_SCHEMA_VERSION,
    };
  }
  return {
    id: record.id,
    value: record.fields.value ?? '',
    updatedAt: record.updatedAt,
    deletedAt: record.fields.deleted_at || null,
    deleted: Boolean(record.fields.deleted_at),
    revision: record.revision,
    deviceId: writer,
    schemaVersion: CLOUD_SCHEMA_VERSION,
  };
}

export function fromCloudDocument(entity: SyncEntityName, id: string, data: CloudFields): CanonicalRecord | null {
  if (!validDocument(entity, id, data)) {
    return null;
  }
  const revision = data.revision as number;
  const updatedAt = data.updatedAt as string;
  const deviceId = data.deviceId as string;
  const deletedAt = typeof data.deletedAt === 'string' ? data.deletedAt : '';
  if (entity === 'transactions') {
    return synced(entity, id, revision, updatedAt, deviceId, {
      type: String(data.type),
      amount: String(data.amount),
      currency: 'VND',
      category_id: String(data.categoryId),
      description: String(data.description ?? ''),
      occurred_at: String(data.occurredAt),
      created_at: String(data.createdAt),
      deleted_at: deletedAt,
      source: String(data.source),
      fingerprint: typeof data.fingerprint === 'string' ? data.fingerprint : '',
      account_id: typeof data.accountId === 'string' ? data.accountId : '',
      transfer_account_id: typeof data.transferAccountId === 'string' ? data.transferAccountId : '',
      transfer_fee: typeof data.transferFee === 'number' ? String(data.transferFee) : '0',
      recurring_rule_id: typeof data.recurringRuleId === 'string' ? data.recurringRuleId : '',
      occurrence_key: typeof data.occurrenceKey === 'string' ? data.occurrenceKey : '',
    });
  }
  if (entity === 'categories') {
    return synced(entity, id, revision, updatedAt, deviceId, {
      name: String(data.name),
      icon: String(data.icon),
      color: String(data.color),
      type: String(data.type),
      is_default: data.isDefault === true ? '1' : '0',
      sort_order: String(data.sortOrder),
      created_at: String(data.createdAt),
      deleted_at: deletedAt,
    });
  }
  if (entity === 'budgets') {
    return synced(entity, id, revision, updatedAt, deviceId, {
      category_id: typeof data.categoryId === 'string' ? data.categoryId : '',
      amount: String(data.amount),
      period: 'month',
      effective_date: String(data.effectiveDate),
      created_at: String(data.createdAt),
      deleted_at: deletedAt,
      warning_threshold_bps: typeof data.warningThreshold1 === 'number' ? String(data.warningThreshold1) : '8000',
      limit_threshold_bps: typeof data.warningThreshold2 === 'number' ? String(data.warningThreshold2) : '10000',
    });
  }
  if (entity === 'accounts') {
    const legacyLast4 = typeof data.last4 === 'string' ? data.last4 : '';
    return synced(entity, id, revision, updatedAt, deviceId, {
      name: String(data.name),
      type: String(data.type),
      bank_code: typeof data.bankCode === 'string' ? data.bankCode : '',
      masked_identifier:
        typeof data.maskedIdentifier === 'string' ? data.maskedIdentifier : legacyLast4 ? `•••• ${legacyLast4}` : '',
      currency: 'VND',
      opening_balance: typeof data.openingBalance === 'number' ? String(data.openingBalance) : '0',
      opening_balance_date: typeof data.openingBalanceDate === 'string' ? data.openingBalanceDate : '1970-01-01',
      archived_at: typeof data.archivedAt === 'string' ? data.archivedAt : '',
      display_order: typeof data.displayOrder === 'number' ? String(data.displayOrder) : '0',
      created_at: typeof data.createdAt === 'string' ? data.createdAt : updatedAt,
      deleted_at: deletedAt,
    });
  }
  return synced(entity, id, revision, updatedAt, deviceId, {
    value: String(data.value ?? ''),
    deleted_at: deletedAt,
  });
}

export type PushDecision = 'write' | 'ack' | 'conflict';

export function clockedRecord(local: CanonicalRecord, remote: CanonicalRecord | null): CanonicalRecord {
  const updatedAt = nextUpdatedAt(local.updatedAt, remote?.updatedAt ?? null);
  if (updatedAt === local.updatedAt) {
    return local;
  }
  return { ...local, updatedAt };
}

export function reconcileRemote(local: CanonicalRecord, remote: CanonicalRecord | null): PushDecision {
  if (!remote) {
    return 'write';
  }
  if (businessEqual(local.entity, local.fields, remote.fields)) {
    return 'ack';
  }
  if (remote.revision > local.syncedRevision) {
    return 'conflict';
  }
  return 'write';
}

function synced(
  entity: SyncEntityName,
  id: string,
  revision: number,
  updatedAt: string,
  deviceId: string,
  fields: Record<string, string>,
): CanonicalRecord {
  return {
    entity,
    id,
    revision,
    syncedRevision: revision,
    syncStatus: 'synced',
    deviceId,
    updatedAt,
    fields,
  };
}

function validDocument(entity: SyncEntityName, id: string, data: CloudFields): boolean {
  if (!ID_PATTERN.test(id) || data.id !== id) {
    return false;
  }
  if (data.schemaVersion !== CLOUD_SCHEMA_VERSION || !validRevision(data.revision) || !isTime(data.updatedAt)) {
    return false;
  }
  if (typeof data.deviceId !== 'string' || data.deviceId.length < 1 || data.deviceId.length > 80) {
    return false;
  }
  if (!deletedMatches(data)) {
    return false;
  }
  if (entity === 'transactions') {
    return validTransaction(data);
  }
  if (entity === 'categories') {
    return validCategory(data);
  }
  if (entity === 'budgets') {
    return validBudget(data);
  }
  if (entity === 'accounts') {
    return validAccount(data);
  }
  return validSettings(id, data);
}

function sanitizeTransactionSource(value: string | undefined): string {
  return (TRANSACTION_SOURCES as readonly string[]).includes(String(value)) ? String(value) : 'manual';
}

function sanitizeOptionalId(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  return ID_PATTERN.test(text) ? text : null;
}

function sanitizeFingerprint(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  return FINGERPRINT_PATTERN.test(text) ? text : null;
}

function sanitizeOccurrenceKey(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  return text && text.length <= 160 ? text : null;
}

function validTransaction(data: CloudFields): boolean {
  return (
    (data.type === 'income' || data.type === 'expense' || data.type === 'transfer') &&
    validAmount(data.amount) &&
    data.currency === 'VND' &&
    isId(data.categoryId) &&
    typeof data.description === 'string' &&
    data.description.length <= 500 &&
    isTime(data.occurredAt) &&
    isTime(data.createdAt) &&
    (TRANSACTION_SOURCES as readonly string[]).includes(String(data.source)) &&
    (data.fingerprint === null || (typeof data.fingerprint === 'string' && FINGERPRINT_PATTERN.test(data.fingerprint))) &&
    (data.accountId === null || isId(data.accountId)) &&
    (data.transferAccountId === null || isId(data.transferAccountId)) &&
    (data.transferFee === undefined || validNonNegativeAmount(data.transferFee)) &&
    (data.recurringRuleId === undefined || data.recurringRuleId === null || isId(data.recurringRuleId)) &&
    (data.occurrenceKey === undefined || data.occurrenceKey === null || (typeof data.occurrenceKey === 'string' && data.occurrenceKey.length <= 160))
  );
}

function validCategory(data: CloudFields): boolean {
  return (
    typeof data.name === 'string' &&
    data.name.trim().length > 0 &&
    data.name.length <= 80 &&
    typeof data.icon === 'string' &&
    data.icon.length > 0 &&
    data.icon.length <= 40 &&
    typeof data.color === 'string' &&
    COLOR_PATTERN.test(data.color) &&
    (data.type === 'expense' || data.type === 'income' || data.type === 'both') &&
    typeof data.isDefault === 'boolean' &&
    typeof data.sortOrder === 'number' &&
    Number.isInteger(data.sortOrder) &&
    data.sortOrder >= 0 &&
    data.sortOrder <= 10_000 &&
    isTime(data.createdAt)
  );
}

function validBudget(data: CloudFields): boolean {
  return (
    validAmount(data.amount) &&
    data.period === 'month' &&
    (data.categoryId === null || isId(data.categoryId)) &&
    isTime(data.effectiveDate) &&
    isTime(data.createdAt) &&
    validOptionalThresholds(data)
  );
}

function validAccount(data: CloudFields): boolean {
  return (
    typeof data.name === 'string' &&
    data.name.trim().length > 0 &&
    data.name.length <= 80 &&
    (data.type === 'cash' || data.type === 'bank' || data.type === 'ewallet' || data.type === 'other') &&
    (data.bankCode === undefined || data.bankCode === null || (typeof data.bankCode === 'string' && data.bankCode.length <= 20)) &&
    (data.last4 === undefined || data.last4 === null || (typeof data.last4 === 'string' && /^\d{4}$/.test(data.last4))) &&
    (data.maskedIdentifier === undefined ||
      data.maskedIdentifier === null ||
      (typeof data.maskedIdentifier === 'string' && data.maskedIdentifier.length <= 40)) &&
    (data.currency === undefined || data.currency === 'VND') &&
    (data.openingBalance === undefined || validSignedAmount(data.openingBalance)) &&
    (data.openingBalanceDate === undefined || isTime(data.openingBalanceDate)) &&
    (data.archivedAt === undefined || data.archivedAt === null || isTime(data.archivedAt)) &&
    (data.displayOrder === undefined ||
      (typeof data.displayOrder === 'number' && Number.isInteger(data.displayOrder) && data.displayOrder >= 0 && data.displayOrder <= 100_000)) &&
    (data.createdAt === undefined || isTime(data.createdAt))
  );
}

function validOptionalThresholds(data: CloudFields): boolean {
  if (data.warningThreshold1 === undefined && data.warningThreshold2 === undefined) {
    return true;
  }
  return (
    typeof data.warningThreshold1 === 'number' &&
    Number.isInteger(data.warningThreshold1) &&
    typeof data.warningThreshold2 === 'number' &&
    Number.isInteger(data.warningThreshold2) &&
    data.warningThreshold1 > 0 &&
    data.warningThreshold1 < data.warningThreshold2 &&
    data.warningThreshold2 <= 100_000
  );
}

function validSettings(id: string, data: CloudFields): boolean {
  return (
    (SYNCED_PREFERENCE_KEYS as readonly string[]).includes(id) &&
    typeof data.value === 'string' &&
    data.value.length <= 40
  );
}

function deletedMatches(data: CloudFields): boolean {
  if (data.deleted === false) {
    return data.deletedAt === null;
  }
  return data.deleted === true && isTime(data.deletedAt);
}

function validAmount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_AMOUNT;
}

function validNonNegativeAmount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_AMOUNT;
}

function validSignedAmount(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_AMOUNT;
}

function validRevision(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1_000_000_000;
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
