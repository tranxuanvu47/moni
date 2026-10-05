import type { DatabaseClient } from '@/src/database/client';
import { getDeviceId } from '@/src/services/sync/device';
import type { CategorizationMatchKind, CategorizationRule } from '@/src/types/finance';
import { toLocalDateTime } from '@/src/utils/dates';
import { createUuid } from '@/src/utils/id';

interface RuleRow {
  id: string;
  match_kind: CategorizationMatchKind;
  pattern: string;
  normalized_pattern: string;
  category_id: string;
  priority: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CategorizationRuleInput {
  matchKind: CategorizationMatchKind;
  pattern: string;
  categoryId: string;
  priority?: number;
  enabled?: boolean;
}

export async function listCategorizationRules(
  db: DatabaseClient,
  options: { includeDisabled?: boolean } = {},
): Promise<CategorizationRule[]> {
  const rows = await db.all<RuleRow>(
    `SELECT * FROM categorization_rules
     WHERE deleted_at IS NULL ${options.includeDisabled ? '' : 'AND enabled = 1'}
     ORDER BY
       CASE match_kind WHEN 'user_defined' THEN 3 WHEN 'exact_merchant' THEN 2 ELSE 1 END DESC,
       priority DESC, updated_at DESC`,
  );
  return rows.map(mapRule);
}

export async function getCategorizationRule(db: DatabaseClient, id: string): Promise<CategorizationRule | null> {
  const row = await db.get<RuleRow>('SELECT * FROM categorization_rules WHERE id = ? AND deleted_at IS NULL', [id]);
  return row ? mapRule(row) : null;
}

export async function upsertCategorizationRule(
  db: DatabaseClient,
  input: CategorizationRuleInput,
): Promise<CategorizationRule> {
  validateInput(input);
  const normalized = normalizeCategorizationText(input.pattern);
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM categorization_rules
     WHERE match_kind = ? AND normalized_pattern = ? AND deleted_at IS NULL`,
    [input.matchKind, normalized],
  );
  if (existing) {
    await updateCategorizationRule(db, existing.id, input);
    const updated = await getCategorizationRule(db, existing.id);
    if (!updated) {
      throw new Error('Không cập nhật được quy tắc phân loại.');
    }
    return updated;
  }

  const id = createUuid();
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `INSERT INTO categorization_rules (
       id, match_kind, pattern, normalized_pattern, category_id, priority, enabled,
       created_at, updated_at, deleted_at, revision, synced_revision, device_id, sync_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, ?, 'pending')`,
    [
      id,
      input.matchKind,
      input.pattern.trim(),
      normalized,
      input.categoryId,
      input.priority ?? defaultPriority(input.matchKind),
      input.enabled === false ? 0 : 1,
      now,
      now,
      deviceId,
    ],
  );
  // Local-first for schema v4. Sync must add this entity before it may enqueue an outbox row.
  const created = await getCategorizationRule(db, id);
  if (!created) {
    throw new Error('Không tạo được quy tắc phân loại.');
  }
  return created;
}

export async function updateCategorizationRule(
  db: DatabaseClient,
  id: string,
  input: CategorizationRuleInput,
): Promise<void> {
  validateInput(input);
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE categorization_rules
     SET match_kind = ?, pattern = ?, normalized_pattern = ?, category_id = ?, priority = ?, enabled = ?,
         updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      input.matchKind,
      input.pattern.trim(),
      normalizeCategorizationText(input.pattern),
      input.categoryId,
      input.priority ?? defaultPriority(input.matchKind),
      input.enabled === false ? 0 : 1,
      now,
      deviceId,
      id,
    ],
  );
}

export async function deleteCategorizationRule(db: DatabaseClient, id: string): Promise<void> {
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE categorization_rules
     SET deleted_at = ?, enabled = 0, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [now, now, deviceId, id],
  );
}

export async function matchCategorizationRule(
  db: DatabaseClient,
  input: { description: string; merchant?: string | null },
): Promise<CategorizationRule | null> {
  const description = normalizeCategorizationText(input.description);
  const merchant = normalizeCategorizationText(input.merchant ?? '');
  const rules = await listCategorizationRules(db);
  return (
    rules.find((rule) => {
      if (rule.matchKind === 'exact_merchant') {
        return Boolean(merchant) && merchant === rule.normalizedPattern;
      }
      return description.includes(rule.normalizedPattern) || (Boolean(merchant) && merchant.includes(rule.normalizedPattern));
    }) ?? null
  );
}

export function normalizeCategorizationText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function defaultPriority(kind: CategorizationMatchKind): number {
  if (kind === 'user_defined') {
    return 300;
  }
  if (kind === 'exact_merchant') {
    return 200;
  }
  return 100;
}

function validateInput(input: CategorizationRuleInput): void {
  if (!normalizeCategorizationText(input.pattern)) {
    throw new Error('Mẫu phân loại không được để trống.');
  }
  if (!Number.isSafeInteger(input.priority ?? defaultPriority(input.matchKind))) {
    throw new Error('Độ ưu tiên quy tắc không hợp lệ.');
  }
}

function mapRule(row: RuleRow): CategorizationRule {
  return {
    id: row.id,
    matchKind: row.match_kind,
    pattern: row.pattern,
    normalizedPattern: row.normalized_pattern,
    categoryId: row.category_id,
    priority: row.priority,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
