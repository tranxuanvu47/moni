import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { DatabaseClient } from '@/src/database/client';
import { createCategory, listCategories } from '@/src/database/repositories/categories';
import { listAllForExport, upsertImportedTransaction } from '@/src/database/repositories/transactions';
import { OTHER_CATEGORY_ID } from '@/src/features/categories/defaults';
import { parseCsv, toCsv } from '@/src/services/export/csv';
import { formatIsoDate, localDateFromDate } from '@/src/utils/dates';

export async function exportTransactions(db: DatabaseClient): Promise<void> {
  const rows = await listAllForExport(db);
  const csv = toCsv(
    rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: row.amount,
      currency: 'VND',
      categoryName: row.categoryName,
      description: row.description,
      occurredAt: row.occurredAt,
    })),
  );
  const file = new File(Paths.cache, `mono-${formatIsoDate(localDateFromDate(new Date()))}.csv`);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(csv);
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Máy này không mở được bảng chia sẻ tệp.');
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Xuất giao dịch', UTI: 'public.comma-separated-values-text' });
}

export async function importTransactions(db: DatabaseClient, csv: string): Promise<{ imported: number; skipped: number }> {
  const rows = parseCsv(csv);
  let imported = 0;
  let skipped = 0;
  const categories = await listCategories(db);

  for (const row of rows) {
    const name = row.categoryName.trim();
    let category = categories.find((item) => item.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'));
    if (!category && name) {
      category = await createCategory(db, { name, icon: 'ellipsis', color: '#777F79', type: row.type === 'income' ? 'income' : 'expense' });
      categories.push(category);
    }
    const categoryId = category?.id ?? OTHER_CATEGORY_ID;
    if (!categoryId || row.amount <= 0) {
      skipped += 1;
      continue;
    }
    await upsertImportedTransaction(db, {
      id: row.id,
      type: row.type,
      amount: row.amount,
      categoryId,
      description: row.description,
      occurredAt: row.occurredAt,
    });
    imported += 1;
  }

  return { imported, skipped };
}
