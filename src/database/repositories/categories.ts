import type { DatabaseClient } from '@/src/database/client';
import { getDeviceId } from '@/src/services/sync/device';
import { noteLocalChange } from '@/src/services/sync/outbox';
import type { Category, CategoryKind } from '@/src/types/finance';
import { createUuid } from '@/src/utils/id';
import { toLocalDateTime } from '@/src/utils/dates';

interface CategoryRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: CategoryKind;
  is_default: number;
  sort_order: number;
}

export async function listCategories(db: DatabaseClient): Promise<Category[]> {
  const rows = await db.all<CategoryRow>('SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC');
  return rows.map(mapCategory);
}

export async function getCategory(db: DatabaseClient, id: string): Promise<Category | null> {
  const row = await db.get<CategoryRow>('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL', [id]);
  return row ? mapCategory(row) : null;
}

export async function createCategory(
  db: DatabaseClient,
  input: { name: string; icon: string; color: string; type: CategoryKind },
): Promise<Category> {
  const id = createUuid();
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  const sort = await db.get<{ max_sort: number | null }>('SELECT MAX(sort_order) AS max_sort FROM categories WHERE deleted_at IS NULL');
  const sortOrder = (sort?.max_sort ?? 0) + 1;
  await db.run(
    `INSERT INTO categories (
       id, name, icon, color, type, is_default, sort_order, created_at, updated_at, deleted_at,
       revision, synced_revision, device_id, sync_status
     ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 1, 0, ?, 'pending')`,
    [id, input.name.trim(), input.icon, input.color, input.type, sortOrder, now, now, deviceId],
  );
  await noteLocalChange(db, 'categories', id, 1, now);
  const created = await getCategory(db, id);
  if (!created) {
    throw new Error('Không tạo được hạng mục.');
  }
  return created;
}

export async function updateCategory(
  db: DatabaseClient,
  id: string,
  input: { name: string; icon: string; color: string },
): Promise<void> {
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE categories
     SET name = ?, icon = ?, color = ?, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [input.name.trim(), input.icon, input.color, now, deviceId, id],
  );
  const row = await db.get<{ revision: number }>('SELECT revision FROM categories WHERE id = ? AND deleted_at IS NULL', [id]);
  if (row) {
    await noteLocalChange(db, 'categories', id, row.revision, now);
  }
}

export async function deleteCategory(db: DatabaseClient, id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const category = await getCategory(db, id);
  if (!category) {
    return { ok: false, reason: 'Không tìm thấy hạng mục.' };
  }
  if (category.isDefault) {
    return { ok: false, reason: 'Hạng mục mặc định chỉ đổi tên, không xóa.' };
  }
  const used = await db.get<{ total: number }>(
    'SELECT COUNT(*) AS total FROM transactions WHERE category_id = ? AND deleted_at IS NULL',
    [id],
  );
  if ((used?.total ?? 0) > 0) {
    return { ok: false, reason: 'Hạng mục đang được dùng trong giao dịch.' };
  }
  const now = toLocalDateTime(new Date());
  const deviceId = await getDeviceId(db);
  await db.run(
    `UPDATE categories
     SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_status = 'pending', device_id = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [now, now, deviceId, id],
  );
  const row = await db.get<{ revision: number }>('SELECT revision FROM categories WHERE id = ?', [id]);
  if (row) {
    await noteLocalChange(db, 'categories', id, row.revision, now);
  }
  return { ok: true };
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    type: row.type,
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order,
  };
}
