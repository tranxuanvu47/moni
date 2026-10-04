import {
  BUSINESS_FIELDS,
  ENTITY_SHEETS,
  HEADERS,
  SCHEMA_VERSION,
  SHEET_NAMES,
  SYNCED_PREFERENCE_KEYS,
  TRANSACTION_SOURCES,
  type DataSheetName,
  type SyncEntityName,
} from '@/src/services/sync/constants';
import { neutralizeSpreadsheetText, readSpreadsheetText } from '@/src/services/sync/sanitize';
import type { CanonicalRecord, SheetSnapshot } from '@/src/services/sync/types';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const MAX_AMOUNT = 1_000_000_000_000;
const MAX_TEXT = 500;

const TEXT_FIELDS = new Set(['description', 'name', 'value', 'icon']);

export function businessEqual(entity: SyncEntityName, left: Record<string, string>, right: Record<string, string>): boolean {
  return BUSINESS_FIELDS[entity].every((key) => (left[key] ?? '') === (right[key] ?? ''));
}

export function encodeRecord(record: CanonicalRecord, deviceId: string): { sheet: DataSheetName; id: string; values: string[] } {
  const sheet = ENTITY_SHEETS[record.entity];
  const header = HEADERS[sheet];
  const source: Record<string, string> = {
    ...record.fields,
    id: record.id,
    updated_at: record.updatedAt,
    revision: String(record.revision),
    device_id: record.deviceId || deviceId,
  };
  const values = header.map((column) => {
    const raw = source[column] ?? '';
    return TEXT_FIELDS.has(column) ? neutralizeSpreadsheetText(raw) : raw;
  });
  return { sheet, id: record.id, values };
}

export function parseSnapshot(
  entity: SyncEntityName,
  snapshot: SheetSnapshot | undefined,
): { records: CanonicalRecord[]; skipped: number } {
  if (!snapshot || snapshot.rows.length === 0) {
    return { records: [], skipped: 0 };
  }
  const header = snapshot.header.length > 0 ? snapshot.header : [...HEADERS[ENTITY_SHEETS[entity]]];
  const expected = HEADERS[ENTITY_SHEETS[entity]];
  if (!sameHeader(header, expected)) {
    return { records: [], skipped: snapshot.rows.length };
  }

  const records: CanonicalRecord[] = [];
  let skipped = 0;
  for (const row of snapshot.rows) {
    const parsed = parseRow(entity, header, row);
    if (parsed) {
      records.push(parsed);
    } else {
      skipped += 1;
    }
  }
  const collapsed = collapseDuplicates(records);
  return { records: collapsed.records, skipped: skipped + collapsed.dropped };
}

export function parseMetadata(snapshot: SheetSnapshot | undefined): { version: string | null; invalid: boolean } {
  if (!snapshot || (snapshot.header.length === 0 && snapshot.rows.length === 0)) {
    return { version: null, invalid: false };
  }
  if (snapshot.header.length > 0 && !sameHeader(snapshot.header, HEADERS[SHEET_NAMES.metadata])) {
    return { version: null, invalid: true };
  }
  const versionRow = snapshot.rows.find((row) => row[0] === 'schema_version');
  return { version: versionRow?.[1] ?? null, invalid: false };
}

export function supportedSchema(version: string | null): boolean {
  return version === null || version === SCHEMA_VERSION;
}

function parseRow(entity: SyncEntityName, header: readonly string[], row: string[]): CanonicalRecord | null {
  const raw = Object.fromEntries(header.map((column, index) => [column, row[index] ?? '']));
  const id = raw.id ?? raw.key ?? '';
  if (!ID_PATTERN.test(id)) {
    return null;
  }

  const fields: Record<string, string> = {};
  for (const column of header) {
    if (column === 'id' || column === 'key' || column === 'revision' || column === 'device_id' || column === 'updated_at') {
      continue;
    }
    const cell = raw[column] ?? '';
    if (TEXT_FIELDS.has(column)) {
      const text = readSpreadsheetText(cell);
      if (!text.ok || text.text.length > MAX_TEXT) {
        return null;
      }
      fields[column] = text.text;
      continue;
    }
    if (readSpreadsheetText(cell).ok === false) {
      return null;
    }
    fields[column] = cell;
  }

  const revision = readRevision(raw.revision ?? '');
  if (!revision) {
    return null;
  }
  const updatedAt = raw.updated_at ?? '';
  if (!TIME_PATTERN.test(updatedAt)) {
    return null;
  }
  if (!validBusiness(entity, id, fields)) {
    return null;
  }

  return {
    entity,
    id,
    revision,
    syncedRevision: revision,
    syncStatus: 'synced',
    deviceId: (raw.device_id ?? '').slice(0, 80),
    updatedAt,
    fields,
  };
}

function validBusiness(entity: SyncEntityName, id: string, fields: Record<string, string>): boolean {
  if (entity === 'transactions') {
    return (
      (fields.type === 'expense' || fields.type === 'income' || fields.type === 'transfer') &&
      fields.currency === 'VND' &&
      validAmount(fields.amount ?? '') &&
      ID_PATTERN.test(fields.category_id ?? '') &&
      TIME_PATTERN.test(fields.occurred_at ?? '') &&
      TIME_PATTERN.test(fields.created_at ?? '') &&
      validOptionalTime(fields.deleted_at ?? '') &&
      validSource(fields.source) &&
      validFingerprint(fields.fingerprint) &&
      validOptionalId(fields.account_id) &&
      validOptionalId(fields.transfer_account_id)
    );
  }
  if (entity === 'categories') {
    return (
      (fields.name ?? '').trim().length > 0 &&
      (fields.type === 'expense' || fields.type === 'income' || fields.type === 'both') &&
      (fields.is_default === '0' || fields.is_default === '1') &&
      /^\d+$/.test(fields.sort_order ?? '') &&
      COLOR_PATTERN.test(fields.color ?? '') &&
      TIME_PATTERN.test(fields.created_at ?? '') &&
      validOptionalTime(fields.deleted_at ?? '')
    );
  }
  if (entity === 'budgets') {
    return (
      validAmount(fields.amount ?? '') &&
      fields.period === 'month' &&
      (fields.category_id === '' || ID_PATTERN.test(fields.category_id ?? '')) &&
      TIME_PATTERN.test(fields.effective_date ?? '') &&
      TIME_PATTERN.test(fields.created_at ?? '') &&
      validOptionalTime(fields.deleted_at ?? '')
    );
  }
  return (SYNCED_PREFERENCE_KEYS as readonly string[]).includes(id) && validOptionalTime(fields.deleted_at ?? '') && (fields.value ?? '').length <= 40;
}

function validAmount(value: string): boolean {
  if (!/^\d+$/.test(value)) {
    return false;
  }
  const amount = Number(value);
  return amount > 0 && amount <= MAX_AMOUNT;
}

function validOptionalTime(value: string): boolean {
  return value === '' || TIME_PATTERN.test(value);
}

function validOptionalId(value: string | undefined): boolean {
  return !value || ID_PATTERN.test(value);
}

function validFingerprint(value: string | undefined): boolean {
  return !value || /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validSource(value: string | undefined): boolean {
  return !value || (TRANSACTION_SOURCES as readonly string[]).includes(value);
}

function readRevision(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const revision = Number(value);
  if (revision < 1 || revision > 1_000_000_000) {
    return null;
  }
  return revision;
}

function sameHeader(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length < expected.length) {
    return false;
  }
  return expected.every((column, index) => actual[index] === column);
}

function collapseDuplicates(records: CanonicalRecord[]): { records: CanonicalRecord[]; dropped: number } {
  const byId = new Map<string, CanonicalRecord>();
  let dropped = 0;
  for (const record of records) {
    const current = byId.get(record.id);
    if (!current) {
      byId.set(record.id, record);
      continue;
    }
    dropped += 1;
    if (record.revision >= current.revision) {
      byId.set(record.id, record);
    }
  }
  return { records: [...byId.values()], dropped };
}

export function emptyFields(entity: SyncEntityName): Record<string, string> {
  return Object.fromEntries(BUSINESS_FIELDS[entity].map((key) => [key, '']));
}
