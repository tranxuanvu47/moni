import type { DatabaseClient, SqlValue } from '@/src/database/client';
import { createTransaction, getTransaction } from '@/src/database/repositories/transactions';
import type {
  InboxSource,
  InboxStatus,
  TransactionInboxDraft,
  TransactionInput,
  TransactionRecord,
  TransactionType,
} from '@/src/types/finance';
import { toLocalDateTime } from '@/src/utils/dates';
import { createUuid } from '@/src/utils/id';

interface DraftRow {
  id: string;
  source: InboxSource;
  source_event_id: string | null;
  fingerprint: string | null;
  status: InboxStatus;
  proposed_type: TransactionType | null;
  amount: number | null;
  currency: 'VND';
  category_id: string | null;
  account_id: string | null;
  transfer_account_id: string | null;
  description: string;
  occurred_at: string | null;
  confidence: number | null;
  duplicate_of_id: string | null;
  confirmed_transaction_id: string | null;
  raw_payload: string | null;
  detected_at: string;
  created_at: string;
  updated_at: string;
}

export interface InboxDraftInput {
  source: InboxSource;
  sourceEventId?: string | null;
  fingerprint?: string | null;
  status?: InboxStatus;
  proposedType?: TransactionType | null;
  amount?: number | null;
  categoryId?: string | null;
  accountId?: string | null;
  transferAccountId?: string | null;
  description?: string;
  occurredAt?: string | null;
  confidence?: number | null;
  duplicateOfId?: string | null;
  rawPayload?: string | null;
  detectedAt?: string;
}

export interface InboxQuery {
  statuses?: InboxStatus[];
  source?: InboxSource | null;
  accountId?: string | null;
  search?: string;
  limit: number;
  offset: number;
}

export async function createInboxDraft(db: DatabaseClient, input: InboxDraftInput): Promise<TransactionInboxDraft> {
  validateDraftInput(input);
  const sourceEventId = clean(input.sourceEventId);
  const fingerprint = clean(input.fingerprint);
  if (sourceEventId) {
    const existing = await findDraft(db, 'source_event_id', input.source, sourceEventId);
    if (existing) {
      return existing;
    }
  }
  if (fingerprint) {
    const existing = await findDraft(db, 'fingerprint', input.source, fingerprint);
    if (existing) {
      if (!sourceEventId || existing.sourceEventId === sourceEventId) {
        return existing;
      }
      input = {
        ...input,
        status: 'duplicate',
        duplicateOfId: existing.confirmedTransactionId ?? existing.id,
      };
    }
  }

  let status = input.status ?? 'pending';
  let duplicateOfId = clean(input.duplicateOfId);
  if (fingerprint && !duplicateOfId) {
    const duplicate = await db.get<{ id: string }>(
      'SELECT id FROM transactions WHERE fingerprint = ? AND deleted_at IS NULL',
      [fingerprint],
    );
    if (duplicate) {
      status = 'duplicate';
      duplicateOfId = duplicate.id;
    }
  }

  const id = createUuid();
  const now = toLocalDateTime(new Date());
  const detectedAt = input.detectedAt ?? now;
  await db.run(
    `INSERT INTO transaction_drafts (
       id, source, source_event_id, fingerprint, status, proposed_type, amount, currency, category_id,
       account_id, transfer_account_id, description, occurred_at, confidence, duplicate_of_id,
       confirmed_transaction_id, raw_payload, detected_at, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'VND', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`,
    [
      id,
      input.source,
      sourceEventId,
      fingerprint,
      status,
      input.proposedType ?? null,
      input.amount ?? null,
      input.categoryId ?? null,
      input.accountId ?? null,
      input.transferAccountId ?? null,
      input.description?.trim() ?? '',
      input.occurredAt ?? null,
      input.confidence ?? null,
      duplicateOfId,
      input.rawPayload ?? null,
      detectedAt,
      now,
      now,
    ],
  );
  const created = await getInboxDraft(db, id);
  if (!created) {
    throw new Error('Không tạo được giao dịch chờ duyệt.');
  }
  return created;
}

export async function getInboxDraft(db: DatabaseClient, id: string): Promise<TransactionInboxDraft | null> {
  const row = await db.get<DraftRow>(
    'SELECT * FROM transaction_drafts WHERE id = ? AND deleted_at IS NULL',
    [id],
  );
  return row ? mapDraft(row) : null;
}

export async function listInboxDrafts(db: DatabaseClient, query: InboxQuery): Promise<TransactionInboxDraft[]> {
  const clauses = ['deleted_at IS NULL'];
  const params: SqlValue[] = [];
  if (query.statuses?.length) {
    clauses.push(`status IN (${query.statuses.map(() => '?').join(', ')})`);
    params.push(...query.statuses);
  }
  if (query.source) {
    clauses.push('source = ?');
    params.push(query.source);
  }
  if (query.accountId) {
    clauses.push('(account_id = ? OR transfer_account_id = ?)');
    params.push(query.accountId, query.accountId);
  }
  if (query.search?.trim()) {
    const escaped = query.search.trim().replace(/[\\%_]/g, (value) => `\\${value}`);
    clauses.push(`(description LIKE ? ESCAPE '\\' OR CAST(amount AS TEXT) LIKE ? ESCAPE '\\')`);
    params.push(`%${escaped}%`, `%${escaped}%`);
  }
  const rows = await db.all<DraftRow>(
    `SELECT * FROM transaction_drafts
     WHERE ${clauses.join(' AND ')}
     ORDER BY detected_at DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, query.limit, query.offset],
  );
  return rows.map(mapDraft);
}

export async function countInboxDrafts(db: DatabaseClient, statuses: InboxStatus[]): Promise<number> {
  if (statuses.length === 0) {
    return 0;
  }
  const row = await db.get<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM transaction_drafts
     WHERE deleted_at IS NULL AND status IN (${statuses.map(() => '?').join(', ')})`,
    statuses,
  );
  return row?.total ?? 0;
}

export function countReviewableInboxDrafts(db: DatabaseClient): Promise<number> {
  return countInboxDrafts(db, ['pending', 'needs_review', 'duplicate']);
}

export async function updateInboxDraft(
  db: DatabaseClient,
  id: string,
  patch: Partial<Omit<InboxDraftInput, 'source' | 'sourceEventId' | 'fingerprint' | 'detectedAt'>>,
): Promise<void> {
  const current = await getInboxDraft(db, id);
  if (!current) {
    throw new Error('Không tìm thấy giao dịch chờ duyệt.');
  }
  const next = {
    status: patch.status ?? current.status,
    proposedType: patch.proposedType === undefined ? current.proposedType : patch.proposedType,
    amount: patch.amount === undefined ? current.amount : patch.amount,
    categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
    accountId: patch.accountId === undefined ? current.accountId : patch.accountId,
    transferAccountId: patch.transferAccountId === undefined ? current.transferAccountId : patch.transferAccountId,
    description: patch.description === undefined ? current.description : patch.description.trim(),
    occurredAt: patch.occurredAt === undefined ? current.occurredAt : patch.occurredAt,
    confidence: patch.confidence === undefined ? current.confidence : patch.confidence,
    duplicateOfId: patch.duplicateOfId === undefined ? current.duplicateOfId : patch.duplicateOfId,
    rawPayload: patch.rawPayload === undefined ? current.rawPayload : patch.rawPayload,
  };
  validateDraftInput({ source: current.source, ...next });
  await db.run(
    `UPDATE transaction_drafts
     SET status = ?, proposed_type = ?, amount = ?, category_id = ?, account_id = ?, transfer_account_id = ?,
         description = ?, occurred_at = ?, confidence = ?, duplicate_of_id = ?, raw_payload = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      next.status,
      next.proposedType,
      next.amount,
      next.categoryId,
      next.accountId,
      next.transferAccountId,
      next.description,
      next.occurredAt,
      next.confidence,
      next.duplicateOfId,
      next.rawPayload,
      toLocalDateTime(new Date()),
      id,
    ],
  );
}

export async function setInboxDraftStatus(db: DatabaseClient, id: string, status: InboxStatus): Promise<void> {
  if (status === 'confirmed') {
    throw new Error('Dùng confirmInboxDraft để xác nhận và tạo giao dịch.');
  }
  await updateInboxDraft(db, id, { status });
}

export async function deleteInboxDraft(db: DatabaseClient, id: string): Promise<void> {
  const now = toLocalDateTime(new Date());
  await db.run(
    `UPDATE transaction_drafts SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [now, now, id],
  );
}

export async function confirmInboxDraft(
  db: DatabaseClient,
  id: string,
  overrides: Partial<TransactionInput> = {},
): Promise<TransactionRecord> {
  const draft = await getInboxDraft(db, id);
  if (!draft) {
    throw new Error('Không tìm thấy giao dịch chờ duyệt.');
  }
  if (draft.status === 'rejected' || draft.status === 'duplicate') {
    throw new Error('Giao dịch này không ở trạng thái có thể xác nhận.');
  }
  if (draft.status === 'confirmed' && draft.confirmedTransactionId) {
    const existing = await getTransaction(db, draft.confirmedTransactionId);
    if (existing) {
      return existing;
    }
  }

  const type = overrides.type ?? draft.proposedType;
  const amount = overrides.amount ?? draft.amount;
  const categoryId = overrides.categoryId ?? draft.categoryId;
  if (!type || !amount || !categoryId) {
    throw new Error('Giao dịch chờ duyệt còn thiếu loại, số tiền hoặc hạng mục.');
  }
  const transaction = await createTransaction(db, {
    type,
    amount,
    categoryId,
    accountId: overrides.accountId === undefined ? draft.accountId : overrides.accountId,
    transferAccountId:
      overrides.transferAccountId === undefined ? draft.transferAccountId : overrides.transferAccountId,
    transferFee: overrides.transferFee,
    description: overrides.description ?? draft.description,
    occurredAt: overrides.occurredAt ?? draft.occurredAt ?? draft.detectedAt,
    source: overrides.source ?? sourceForTransaction(draft.source),
    fingerprint: overrides.fingerprint === undefined ? draft.fingerprint : overrides.fingerprint,
    recurringRuleId: overrides.recurringRuleId,
    occurrenceKey: overrides.occurrenceKey,
  });
  await db.run(
    `UPDATE transaction_drafts
     SET status = 'confirmed', confirmed_transaction_id = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [transaction.id, toLocalDateTime(new Date()), id],
  );
  return transaction;
}

export async function confirmInboxDrafts(
  db: DatabaseClient,
  ids: string[],
): Promise<{ confirmed: TransactionRecord[]; failed: { id: string; message: string }[] }> {
  const confirmed: TransactionRecord[] = [];
  const failed: { id: string; message: string }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      confirmed.push(await confirmInboxDraft(db, id));
    } catch (error) {
      failed.push({ id, message: error instanceof Error ? error.message : 'Không xác nhận được giao dịch.' });
    }
  }
  return { confirmed, failed };
}

function validateDraftInput(input: InboxDraftInput): void {
  if (input.amount != null && (!Number.isSafeInteger(input.amount) || input.amount <= 0)) {
    throw new Error('Số tiền gợi ý phải là số nguyên VND lớn hơn 0.');
  }
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
    throw new Error('Độ tin cậy phải nằm trong khoảng 0 đến 1.');
  }
}

async function findDraft(
  db: DatabaseClient,
  column: 'source_event_id' | 'fingerprint',
  source: InboxSource,
  value: string,
): Promise<TransactionInboxDraft | null> {
  const row = await db.get<DraftRow>(
    `SELECT * FROM transaction_drafts WHERE source = ? AND ${column} = ? AND deleted_at IS NULL`,
    [source, value],
  );
  return row ? mapDraft(row) : null;
}

function sourceForTransaction(source: InboxSource): TransactionInput['source'] {
  return source === 'imported_statement' ? 'sheets' : source;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function mapDraft(row: DraftRow): TransactionInboxDraft {
  return {
    id: row.id,
    source: row.source,
    sourceEventId: row.source_event_id,
    fingerprint: row.fingerprint,
    status: row.status,
    proposedType: row.proposed_type,
    amount: row.amount,
    currency: 'VND',
    categoryId: row.category_id,
    accountId: row.account_id,
    transferAccountId: row.transfer_account_id,
    description: row.description,
    occurredAt: row.occurred_at,
    confidence: row.confidence,
    duplicateOfId: row.duplicate_of_id,
    confirmedTransactionId: row.confirmed_transaction_id,
    rawPayload: row.raw_payload,
    detectedAt: row.detected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
