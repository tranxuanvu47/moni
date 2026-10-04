import { compareCloudOrder, isAfterCursor, type PullCursor } from '@/src/services/sync/cursor';
import { clockedRecord, fromCloudDocument, reconcileRemote, toCloudDocument } from '@/src/services/sync/firestore-doc';
import { CLOUD_SCHEMA_VERSION, type SyncEntityName } from '@/src/services/sync/constants';
import { SyncHttpError, type CanonicalRecord, type CloudAccount, type CloudPage, type CloudPushResult, type CloudStore } from '@/src/services/sync/types';

export class MemoryCloudStore implements CloudStore {
  readonly id = 'firestore-memory';
  account: CloudAccount | null = { uid: 'user-1', email: 'me@gmail.com' };
  remoteSchema: number | null = null;
  failWrites = 0;
  private readonly docs = new Map<string, CanonicalRecord>();

  async getAccount(): Promise<CloudAccount | null> {
    return this.account;
  }

  async readRemoteSchema(): Promise<number | null> {
    return this.remoteSchema;
  }

  async writeProfile(): Promise<void> {
    this.remoteSchema = CLOUD_SCHEMA_VERSION;
  }

  async pull(uid: string, entity: SyncEntityName, cursor: PullCursor | null, limit: number): Promise<CloudPage> {
    const rows = [...this.docs.values()]
      .filter((row) => row.entity === entity && this.owner(row) === uid && isAfterCursor(row, cursor))
      .sort(compareCloudOrder);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      records: page,
      skipped: 0,
      nextCursor: last ? { updatedAt: last.updatedAt, revision: last.revision, id: last.id } : cursor,
      hasMore: rows.length > limit,
    };
  }

  async upsert(uid: string, records: CanonicalRecord[], deviceId: string): Promise<CloudPushResult> {
    if (this.failWrites > 0) {
      this.failWrites -= 1;
      throw new SyncHttpError('Firestore đang bận. Thử lại sau ít phút.', 429, null);
    }
    const result: CloudPushResult = { written: [], acknowledged: [], conflicts: [] };
    for (const record of records) {
      const existing = this.docs.get(this.key(uid, record.entity, record.id)) ?? null;
      const decision = reconcileRemote(record, existing);
      if (decision === 'conflict' && existing) {
        result.conflicts.push({ local: record, remote: existing });
        continue;
      }
      if (decision === 'ack' && existing) {
        result.acknowledged.push({
          entity: record.entity,
          id: record.id,
          revision: Math.max(record.revision, existing.revision),
        });
        continue;
      }
      const stamped = clockedRecord(record, existing);
      const parsed = fromCloudDocument(stamped.entity, stamped.id, toCloudDocument(stamped, deviceId));
      if (!parsed) {
        throw new Error('Bản ghi không đúng schema Firestore nên chưa được gửi.');
      }
      this.docs.set(this.key(uid, record.entity, record.id), parsed);
      result.written.push({ entity: stamped.entity, id: stamped.id, revision: stamped.revision });
    }
    return result;
  }

  seed(uid: string, record: CanonicalRecord): void {
    const parsed = fromCloudDocument(record.entity, record.id, toCloudDocument(record, record.deviceId || 'seed'));
    if (!parsed) {
      throw new Error('Không seed được bản ghi Firestore.');
    }
    this.docs.set(this.key(uid, record.entity, record.id), parsed);
  }

  records(entity: SyncEntityName, uid = this.account?.uid ?? 'user-1'): CanonicalRecord[] {
    return [...this.docs.values()].filter((row) => row.entity === entity && this.owner(row) === uid);
  }

  countAll(): number {
    return this.docs.size;
  }

  private key(uid: string, entity: SyncEntityName, id: string): string {
    return `${uid}/${entity}/${id}`;
  }

  private owner(record: CanonicalRecord): string {
    const slash = [...this.docs.entries()].find(([, value]) => value === record)?.[0];
    return slash?.split('/')[0] ?? '';
  }
}
