export interface PullCursor {
  updatedAt: string;
  revision: number;
  id: string;
}

export function encodeCursor(cursor: PullCursor | null): string {
  if (!cursor) {
    return '';
  }
  return `${cursor.updatedAt}\n${cursor.revision}\n${cursor.id}`;
}

export function decodeCursor(value: string | null): PullCursor | null {
  if (!value) {
    return null;
  }
  const [updatedAt, revisionText, ...idParts] = value.split('\n');
  const revision = Number(revisionText);
  const id = idParts.join('\n');
  if (!updatedAt || !id || !Number.isInteger(revision)) {
    return null;
  }
  return { updatedAt, revision, id };
}

export function compareCloudOrder(
  left: { updatedAt: string; revision: number; id: string },
  right: { updatedAt: string; revision: number; id: string },
): number {
  if (left.updatedAt < right.updatedAt) {
    return -1;
  }
  if (left.updatedAt > right.updatedAt) {
    return 1;
  }
  if (left.revision !== right.revision) {
    return left.revision - right.revision;
  }
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

export function nextUpdatedAt(current: string, remote: string | null): string {
  if (!remote || current > remote) {
    return current;
  }
  return addOneSecond(remote);
}

function addOneSecond(value: string): string {
  const [date, time] = value.split('T');
  if (!date || !time) {
    return value;
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const next = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, (second ?? 0) + 1);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}:${pad(next.getSeconds())}`;
}

export function isAfterCursor(
  record: { updatedAt: string; revision: number; id: string },
  cursor: PullCursor | null,
): boolean {
  if (!cursor) {
    return true;
  }
  return compareCloudOrder(record, cursor) > 0;
}
