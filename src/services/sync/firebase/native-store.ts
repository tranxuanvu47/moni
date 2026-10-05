import {
  FieldPath,
  FieldValue,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  startAfter,
} from '@react-native-firebase/firestore';

type PullDoc = {
  id: string;
  data: () => Record<string, unknown>;
};

import { CLOUD_SCHEMA_VERSION, type SyncEntityName } from '@/src/services/sync/constants';
import type { PullCursor } from '@/src/services/sync/cursor';
import { assertReadableSchema, clockedRecord, fromCloudDocument, reconcileRemote, toCloudDocument, type CloudFields } from '@/src/services/sync/firestore-doc';
import { currentFirebaseAccount } from '@/src/services/sync/firebase/auth';
import { SyncHttpError, type CanonicalRecord, type CloudPage, type CloudPushResult, type CloudStore } from '@/src/services/sync/types';

const documentId = new FieldPath('__name__');

export function createNativeFirestoreStore(): CloudStore {
  return {
    id: 'firestore',
    getAccount: currentFirebaseAccount,
    async readRemoteSchema(uid) {
      try {
        const snapshot = await getDoc(doc(getFirestore(), 'users', uid));
        if (!snapshot.exists()) {
          return null;
        }
        const value = snapshot.get('schemaVersion');
        return typeof value === 'number' ? value : null;
      } catch (error) {
        throw mapFirestoreError(error);
      }
    },
    async pull(uid, entity, cursor, pageSize) {
      try {
        return await pullPageIndexed(uid, entity, cursor, pageSize);
      } catch (error) {
        if (!isIndexUnavailableError(error)) {
          throw mapFirestoreError(error);
        }
        // Index đang build — đọc không composite order (ổn với sổ cá nhân nhỏ).
        try {
          return await pullPageFallback(uid, entity, cursor, pageSize);
        } catch (fallbackError) {
          throw mapFirestoreError(fallbackError);
        }
      }
    },
    async upsert(uid, records, deviceId) {
      return pushRecords(uid, records, deviceId);
    },
    async writeProfile(uid, profile) {
      try {
        await setDoc(
          doc(getFirestore(), 'users', uid),
          {
            email: profile.email,
            displayName: profile.displayName,
            currency: 'VND',
            schemaVersion: CLOUD_SCHEMA_VERSION,
            updatedAt: profile.updatedAt,
            serverUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch (error) {
        throw mapFirestoreError(error);
      }
    },
  };
}

async function pullPageIndexed(uid: string, entity: SyncEntityName, cursor: PullCursor | null, pageSize: number): Promise<CloudPage> {
  const collectionRef = collection(doc(getFirestore(), 'users', uid), entity);
  const pageQuery = cursor
    ? query(
        collectionRef,
        orderBy('updatedAt', 'asc'),
        orderBy('revision', 'asc'),
        orderBy(documentId, 'asc'),
        startAfter(cursor.updatedAt, cursor.revision, cursor.id),
        limit(pageSize),
      )
    : query(collectionRef, orderBy('updatedAt', 'asc'), orderBy('revision', 'asc'), orderBy(documentId, 'asc'), limit(pageSize));
  const snapshot = await getDocs(pageQuery);
  return mapPullDocs(entity, snapshot.docs as PullDoc[], cursor, snapshot.size === pageSize);
}

async function pullPageFallback(
  uid: string,
  entity: SyncEntityName,
  cursor: PullCursor | null,
  pageSize: number,
): Promise<CloudPage> {
  const collectionRef = collection(doc(getFirestore(), 'users', uid), entity);
  const snapshot = await getDocs(collectionRef);
  const sorted = [...(snapshot.docs as PullDoc[])].sort(comparePullDocs);
  const start = cursor ? sorted.findIndex((item) => compareCursorDoc(item, cursor) > 0) : 0;
  const from = start < 0 ? sorted.length : start;
  const page = sorted.slice(from, from + pageSize);
  return mapPullDocs(entity, page, cursor, from + pageSize < sorted.length);
}

function mapPullDocs(
  entity: SyncEntityName,
  docs: PullDoc[],
  cursor: PullCursor | null,
  hasMore: boolean,
): CloudPage {
  const records: CanonicalRecord[] = [];
  let skipped = 0;
  let nextCursor = cursor;
  for (const item of docs) {
    const data = asFields(item.data());
    if (!data) {
      skipped += 1;
      continue;
    }
    assertReadableSchema(data);
    const updatedAt = data.updatedAt;
    if (typeof updatedAt !== 'string') {
      throw new Error('Firestore có bản ghi thiếu thời điểm cập nhật.');
    }
    const revision = data.revision;
    if (typeof revision !== 'number') {
      throw new Error('Firestore có bản ghi thiếu revision.');
    }
    nextCursor = { updatedAt, revision, id: item.id };
    const record = fromCloudDocument(entity, item.id, data);
    if (record) {
      records.push(record);
    } else {
      skipped += 1;
    }
  }
  return { records, skipped, nextCursor, hasMore };
}

function comparePullDocs(left: PullDoc, right: PullDoc): number {
  const leftData = asFields(left.data()) ?? {};
  const rightData = asFields(right.data()) ?? {};
  const leftAt = typeof leftData.updatedAt === 'string' ? leftData.updatedAt : '';
  const rightAt = typeof rightData.updatedAt === 'string' ? rightData.updatedAt : '';
  if (leftAt !== rightAt) {
    return leftAt < rightAt ? -1 : 1;
  }
  const leftRevision = typeof leftData.revision === 'number' ? leftData.revision : 0;
  const rightRevision = typeof rightData.revision === 'number' ? rightData.revision : 0;
  if (leftRevision !== rightRevision) {
    return leftRevision - rightRevision;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareCursorDoc(item: PullDoc, cursor: PullCursor): number {
  const data = asFields(item.data()) ?? {};
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : '';
  if (updatedAt !== cursor.updatedAt) {
    return updatedAt < cursor.updatedAt ? -1 : 1;
  }
  const revision = typeof data.revision === 'number' ? data.revision : 0;
  if (revision !== cursor.revision) {
    return revision - cursor.revision;
  }
  return item.id < cursor.id ? -1 : item.id > cursor.id ? 1 : 0;
}

async function pushRecords(uid: string, records: CanonicalRecord[], deviceId: string): Promise<CloudPushResult> {
  const result: CloudPushResult = { written: [], acknowledged: [], conflicts: [] };
  const database = getFirestore();
  for (const record of records) {
    const reference = doc(database, 'users', uid, record.entity, record.id);
    try {
      const outcome = await runTransaction(database, async (transaction) => {
        const snapshot = await transaction.get(reference);
        const remote = snapshot.exists() ? fromCloudDocument(record.entity, record.id, asFields(snapshot.data()) ?? {}) : null;
        if (snapshot.exists() && !remote) {
          throw new Error('Bản ghi Firestore hiện có không đúng schema. Chưa ghi đè.');
        }
        const decision = reconcileRemote(record, remote);
        if (decision === 'conflict' && remote) {
          return { kind: 'conflict' as const, remote };
        }
        if (decision === 'ack' && remote) {
          return { kind: 'ack' as const, revision: Math.max(record.revision, remote.revision) };
        }
        const stamped = clockedRecord(record, remote);
        const payload = toCloudDocument(stamped, deviceId);
        if (!fromCloudDocument(stamped.entity, stamped.id, payload)) {
          throw new Error('Bản ghi không đúng schema Firestore nên chưa được gửi.');
        }
        transaction.set(reference, { ...payload, serverUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { kind: 'write' as const };
      });
      if (outcome.kind === 'conflict') {
        result.conflicts.push({ local: record, remote: outcome.remote });
        continue;
      }
      if (outcome.kind === 'ack') {
        result.acknowledged.push({ entity: record.entity, id: record.id, revision: outcome.revision });
        continue;
      }
      result.written.push({ entity: record.entity, id: record.id, revision: record.revision });
    } catch (error) {
      throw mapFirestoreError(error, `${record.entity}/${record.id}`);
    }
  }
  return result;
}

function asFields(value: unknown): CloudFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as CloudFields;
}

function isIndexUnavailableError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    code.includes('failed-precondition') ||
    message.includes('requires an index') ||
    message.includes('index is currently building') ||
    message.includes('cannot be used yet')
  );
}

function mapFirestoreError(error: unknown, target?: string): Error {
  if (error instanceof Error && error.message.startsWith('Bản ghi')) {
    return error;
  }
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error instanceof Error ? error.message : '';
  if (code.includes('permission-denied')) {
    return new Error(target ? `Không có quyền đồng bộ ${target}. Đăng nhập lại hoặc thử lại sau.` : 'Không có quyền đồng bộ. Đăng nhập lại hoặc thử lại sau.');
  }
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('resource-exhausted')) {
    return new SyncHttpError('Máy chủ đồng bộ đang bận. Thử lại sau ít phút.', 429, null);
  }
  if (isIndexUnavailableError(error)) {
    return new Error('Đồng bộ đang được chuẩn bị phía máy chủ. Đợi vài phút rồi thử lại.');
  }
  if (code.includes('not-found') || message.includes('does not exist')) {
    return new Error('Chưa sẵn sàng đồng bộ đám mây. Thử lại sau hoặc cập nhật app.');
  }
  return error instanceof Error ? error : new Error('Không đồng bộ được lên đám mây.');
}
