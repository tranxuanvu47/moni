import { businessEqual } from '@/src/services/sync/codec';
import type { SyncEntityName } from '@/src/services/sync/constants';
import type { CanonicalRecord } from '@/src/services/sync/types';

export interface MergePlan {
  push: CanonicalRecord[];
  apply: CanonicalRecord[];
  ack: Array<{ entity: SyncEntityName; id: string; revision: number }>;
  conflicts: Array<{ local: CanonicalRecord; remote: CanonicalRecord | null }>;
}

export function mergeRecords(localRows: CanonicalRecord[], remoteRows: CanonicalRecord[]): MergePlan {
  const local = indexRows(localRows);
  const remote = indexRows(remoteRows);
  const keys = new Set([...local.keys(), ...remote.keys()]);
  const plan: MergePlan = { push: [], apply: [], ack: [], conflicts: [] };

  for (const key of keys) {
    const left = local.get(key);
    const right = remote.get(key);
    if (left && !right) {
      considerLocalOnly(left, plan);
      continue;
    }
    if (!left && right) {
      plan.apply.push(right);
      continue;
    }
    if (left && right) {
      considerPair(left, right, plan);
    }
  }

  return plan;
}

function considerLocalOnly(local: CanonicalRecord, plan: MergePlan): void {
  if (local.syncStatus === 'conflict') {
    return;
  }
  if (local.entity === 'categories' && local.fields.is_default === '1') {
    plan.push.push(local);
    return;
  }
  if (local.syncStatus === 'pending' || local.revision > local.syncedRevision) {
    plan.push.push(local);
    return;
  }
  plan.conflicts.push({ local, remote: null });
}

function considerPair(local: CanonicalRecord, remote: CanonicalRecord, plan: MergePlan): void {
  if (local.syncStatus === 'conflict') {
    plan.conflicts.push({ local, remote });
    return;
  }

  if (businessEqual(local.entity, local.fields, remote.fields)) {
    if (local.revision > remote.revision) {
      plan.push.push(local);
      return;
    }
    if (remote.revision > local.revision || local.syncStatus === 'pending') {
      plan.ack.push({ entity: local.entity, id: local.id, revision: remote.revision });
    }
    return;
  }

  const remoteMoved = remote.revision > local.syncedRevision;
  if (local.syncStatus === 'pending' && remoteMoved) {
    plan.conflicts.push({ local, remote });
    return;
  }
  if (local.syncStatus === 'pending') {
    plan.push.push(local);
    return;
  }
  if (remote.revision > local.revision) {
    plan.apply.push(remote);
    return;
  }
  if (remote.revision < local.revision) {
    plan.push.push(local);
    return;
  }
  plan.conflicts.push({ local, remote });
}

export function mergeDelta(localRows: CanonicalRecord[], remoteRows: CanonicalRecord[]): MergePlan {
  const local = indexRows(localRows);
  const plan: MergePlan = { push: [], apply: [], ack: [], conflicts: [] };
  for (const remote of remoteRows) {
    const left = local.get(`${remote.entity}:${remote.id}`);
    if (!left) {
      plan.apply.push(remote);
      continue;
    }
    considerPair(left, remote, plan);
  }
  return plan;
}

export function uploadsFrom(localRows: CanonicalRecord[], plan: MergePlan, blocked: Set<string>): CanonicalRecord[] {
  const skip = new Set<string>();
  for (const row of plan.apply) {
    skip.add(`${row.entity}:${row.id}`);
  }
  for (const row of plan.ack) {
    skip.add(`${row.entity}:${row.id}`);
  }
  for (const row of plan.conflicts) {
    skip.add(`${row.local.entity}:${row.local.id}`);
  }

  const chosen = new Map<string, CanonicalRecord>();
  for (const row of [...plan.push, ...localRows]) {
    const key = `${row.entity}:${row.id}`;
    if (skip.has(key) || blocked.has(key) || row.syncStatus === 'conflict') {
      continue;
    }
    const pending = row.syncStatus === 'pending' || row.revision > row.syncedRevision;
    if (!pending && !plan.push.includes(row)) {
      continue;
    }
    chosen.set(key, row);
  }
  return [...chosen.values()];
}

function indexRows(rows: CanonicalRecord[]): Map<string, CanonicalRecord> {
  const map = new Map<string, CanonicalRecord>();
  for (const row of rows) {
    map.set(`${row.entity}:${row.id}`, row);
  }
  return map;
}
