import type { DatabaseClient } from '@/src/database/client';
import { parseMetadata, parseSnapshot, supportedSchema } from '@/src/services/sync/codec';
import { ENTITY_SHEETS, SHEET_NAMES, type SyncEntityName } from '@/src/services/sync/constants';
import { applyRemoteRecord } from '@/src/services/sync/local-store';
import type { CanonicalRecord, SheetSnapshot } from '@/src/services/sync/types';

export interface RestorePreview {
  transactions: number;
  deletedTransactions: number;
  categories: number;
  accounts: number;
  budgets: number;
  settings: number;
  skipped: number;
}

const ORDER: SyncEntityName[] = ['categories', 'settings', 'accounts', 'budgets', 'transactions'];

export function previewSheets(sheets: Partial<Record<string, SheetSnapshot>>): RestorePreview {
  assertSchema(sheets[SHEET_NAMES.metadata]);
  const parsed = parseAll(sheets);
  return summarize(parsed.records, parsed.skipped);
}

export async function applySheetRestore(
  db: DatabaseClient,
  sheets: Partial<Record<string, SheetSnapshot>>,
): Promise<{ preview: RestorePreview; attachmentUris: string[] }> {
  assertSchema(sheets[SHEET_NAMES.metadata]);
  const parsed = parseAll(sheets);
  const files = await db.all<{ local_uri: string }>('SELECT local_uri FROM attachments');
  await db.transaction(async () => {
    await db.exec('DELETE FROM attachments');
    await db.exec('DELETE FROM transactions');
    await db.exec('DELETE FROM budgets');
    await db.exec('DELETE FROM sync_outbox');
    await db.exec('DELETE FROM sync_conflicts');
    await db.exec('DELETE FROM categories WHERE is_default = 0');
    for (const entity of ORDER) {
      for (const record of parsed.records.filter((item) => item.entity === entity)) {
        await applyRemoteRecord(db, record);
      }
    }
  });
  return {
    preview: summarize(parsed.records, parsed.skipped),
    attachmentUris: files.map((file) => file.local_uri),
  };
}

function parseAll(sheets: Partial<Record<string, SheetSnapshot>>): { records: CanonicalRecord[]; skipped: number } {
  const records: CanonicalRecord[] = [];
  let skipped = 0;
  for (const entity of ORDER) {
    const parsed = parseSnapshot(entity, sheets[ENTITY_SHEETS[entity]]);
    records.push(...parsed.records);
    skipped += parsed.skipped;
  }
  return { records, skipped };
}

function summarize(records: CanonicalRecord[], skipped: number): RestorePreview {
  const transactions = records.filter((record) => record.entity === 'transactions');
  return {
    transactions: transactions.filter((record) => !record.fields.deleted_at).length,
    deletedTransactions: transactions.filter((record) => record.fields.deleted_at).length,
    categories: records.filter((record) => record.entity === 'categories' && !record.fields.deleted_at).length,
    accounts: records.filter((record) => record.entity === 'accounts' && !record.fields.deleted_at).length,
    budgets: records.filter((record) => record.entity === 'budgets' && !record.fields.deleted_at).length,
    settings: records.filter((record) => record.entity === 'settings' && !record.fields.deleted_at).length,
    skipped,
  };
}

function assertSchema(snapshot: SheetSnapshot | undefined): void {
  const metadata = parseMetadata(snapshot);
  if (metadata.invalid || !supportedSchema(metadata.version)) {
    throw new Error('File Google Sheets dùng phiên bản mới hơn ứng dụng. Chưa thay dữ liệu trên máy.');
  }
}
