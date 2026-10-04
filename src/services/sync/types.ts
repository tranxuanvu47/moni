import type { DataSheetName, SyncEntityName } from '@/src/services/sync/constants';
import type { PullCursor } from '@/src/services/sync/cursor';

export type RowSyncStatus = 'pending' | 'synced' | 'conflict';

export interface CanonicalRecord {
  entity: SyncEntityName;
  id: string;
  revision: number;
  syncedRevision: number;
  syncStatus: RowSyncStatus;
  deviceId: string;
  updatedAt: string;
  fields: Record<string, string>;
}

export interface SheetSnapshot {
  header: string[];
  rows: string[][];
}

export interface SheetRowUpdate {
  id: string;
  values: string[];
}

export interface SyncAccount {
  email: string;
}

export interface SyncProvider {
  readonly id: string;
  getAccount(): Promise<SyncAccount | null>;
  connect(): Promise<SyncAccount>;
  disconnect(): Promise<void>;
  ensureWorkbook(title: string): Promise<{ spreadsheetId: string }>;
  readSheets(spreadsheetId: string): Promise<Partial<Record<DataSheetName, SheetSnapshot>>>;
  upsertRows(spreadsheetId: string, sheet: DataSheetName, header: readonly string[], rows: SheetRowUpdate[]): Promise<void>;
}

export interface StoredConflict {
  entity: SyncEntityName;
  id: string;
  local: CanonicalRecord;
  remote: CanonicalRecord | null;
  detectedAt: string;
}

export type SyncCycleResult =
  | { outcome: 'disabled' }
  | { outcome: 'offline'; pending: number }
  | { outcome: 'waiting'; pending: number; nextAttemptAt: string }
  | { outcome: 'ok'; pushed: number; pulled: number; conflicts: number; pending: number; skipped: number }
  | { outcome: 'error'; message: string; pending: number };

export class SyncHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message);
    this.name = 'SyncHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface CloudAccount {
  uid: string;
  email: string;
}

export interface CloudPage {
  records: CanonicalRecord[];
  skipped: number;
  nextCursor: PullCursor | null;
  hasMore: boolean;
}

export interface CloudPushResult {
  written: Array<{ entity: SyncEntityName; id: string; revision: number }>;
  acknowledged: Array<{ entity: SyncEntityName; id: string; revision: number }>;
  conflicts: Array<{ local: CanonicalRecord; remote: CanonicalRecord }>;
}

export interface CloudStore {
  readonly id: string;
  getAccount(): Promise<CloudAccount | null>;
  readRemoteSchema(uid: string): Promise<number | null>;
  pull(uid: string, entity: SyncEntityName, cursor: PullCursor | null, limit: number): Promise<CloudPage>;
  upsert(uid: string, records: CanonicalRecord[], deviceId: string): Promise<CloudPushResult>;
  writeProfile(uid: string, profile: { email: string; displayName: string; updatedAt: string }): Promise<void>;
}

export function isRetryableSyncError(error: unknown): boolean {
  if (error instanceof SyncHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  if (error instanceof TypeError) {
    return true;
  }
  return false;
}
