import { listCategories } from '@/src/database/repositories/categories';
import { createTransaction } from '@/src/database/repositories/transactions';
import type { DatabaseClient } from '@/src/database/client';
import { parseBankNotification, type BankNotificationLike } from '@/src/features/bank/parse-notification';
import { parseExpenseText } from '@/src/features/ai/local-parser';
import { INCOME_CATEGORY_ID, OTHER_CATEGORY_ID } from '@/src/features/categories/defaults';
import { analyzeBankNotificationWithAi, getAiRuntimeConfig } from '@/src/services/ai/shopaikey';
import { toLocalDateTime } from '@/src/utils/dates';
import { formatVnd } from '@/src/utils/money';

export type BankIngestResult =
  | { outcome: 'ignored' }
  | { outcome: 'duplicate'; fingerprint: string }
  | { outcome: 'saved'; id: string; description: string; amount: number };

export async function ingestBankNotification(
  db: DatabaseClient,
  notification: BankNotificationLike,
): Promise<BankIngestResult> {
  const parsed = parseBankNotification(notification);
  if (!parsed) {
    return { outcome: 'ignored' };
  }

  const existing = await db.get<{ id: string }>(
    'SELECT id FROM transactions WHERE fingerprint = ? AND deleted_at IS NULL',
    [parsed.fingerprint],
  );
  if (existing) {
    return { outcome: 'duplicate', fingerprint: parsed.fingerprint };
  }

  const categories = await listCategories(db);
  let categoryId = parsed.categoryId;
  let description = parsed.description;

  const localDraft = parseExpenseText(
    `${parsed.type === 'income' ? 'nhận' : 'chi'} ${parsed.amount} ${parsed.rawBody}`,
    categories,
    new Date(parsed.occurredAtMs),
  )[0];
  if (localDraft?.categoryId && !localDraft.categoryUncertain) {
    categoryId = localDraft.categoryId;
  }

  const aiConfig = await getAiRuntimeConfig().catch(() => null);
  if (aiConfig) {
    try {
      const relevantNames = categories
        .filter((category) => category.type === parsed.type || category.type === 'both')
        .map((category) => category.name);
      const analysis = await analyzeBankNotificationWithAi({
        rawBody: parsed.rawBody,
        type: parsed.type,
        amount: parsed.amount,
        bankLabel: parsed.bankLabel,
        categoryNames: relevantNames.length > 0 ? relevantNames : categories.map((category) => category.name),
      });
      const matched = categories.find(
        (category) => category.name.toLocaleLowerCase('vi') === analysis.category.toLocaleLowerCase('vi'),
      );
      if (matched) {
        categoryId = matched.id;
      }
      if (analysis.description) {
        const money = `${parsed.type === 'income' ? '+' : '−'}${formatVnd(parsed.amount)}`;
        description = `${parsed.bankLabel} · ${money} · ${analysis.description}`.slice(0, 400);
      }
    } catch {
      // Giữ kết quả parser/local khi AI lỗi hoặc offline.
    }
  }

  try {
    const created = await createTransaction(db, {
      type: parsed.type,
      amount: parsed.amount,
      categoryId: categoryId || (parsed.type === 'income' ? INCOME_CATEGORY_ID : OTHER_CATEGORY_ID),
      description,
      occurredAt: toLocalDateTime(new Date(parsed.occurredAtMs)),
      source: 'bank_notification',
      fingerprint: parsed.fingerprint,
    });
    return { outcome: 'saved', id: created.id, description: created.description, amount: created.amount };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.toLowerCase().includes('unique') || message.toLowerCase().includes('constraint')) {
      return { outcome: 'duplicate', fingerprint: parsed.fingerprint };
    }
    throw error;
  }
}
