import type { DatabaseClient } from '@/src/database/client';
import { getDefaultAccount, listAccounts } from '@/src/database/repositories/accounts';
import { listCategories } from '@/src/database/repositories/categories';
import { matchCategorizationRule } from '@/src/database/repositories/categorization-rules';
import { createInboxDraft } from '@/src/database/repositories/inbox';
import { parseExpenseText } from '@/src/features/ai/local-parser';
import { parseBankNotification, type BankNotificationLike } from '@/src/features/bank/parse-notification';
import { INCOME_CATEGORY_ID, OTHER_CATEGORY_ID } from '@/src/features/categories/defaults';
import { toLocalDateTime } from '@/src/utils/dates';

export type BankIngestResult =
  | { outcome: 'ignored' }
  | { outcome: 'duplicate'; fingerprint: string }
  | { outcome: 'pending'; id: string; description: string; amount: number };

export async function ingestBankNotification(
  db: DatabaseClient,
  notification: BankNotificationLike,
): Promise<BankIngestResult> {
  const parsed = parseBankNotification(notification);
  if (!parsed) return { outcome: 'ignored' };

  const existingTransaction = await db.get<{ id: string }>(
    'SELECT id FROM transactions WHERE fingerprint = ? AND deleted_at IS NULL',
    [parsed.fingerprint],
  );
  const existingDraft = await db.get<{ id: string }>(
    'SELECT id FROM transaction_drafts WHERE source = ? AND fingerprint = ? AND deleted_at IS NULL',
    ['bank_notification', parsed.fingerprint],
  );
  if (existingTransaction || existingDraft) return { outcome: 'duplicate', fingerprint: parsed.fingerprint };

  const categories = await listCategories(db);
  const [defaultAccount, accounts] = await Promise.all([getDefaultAccount(db), listAccounts(db)]);
  const bankNeedle = parsed.bankLabel.toLocaleLowerCase('vi').replace(/[^a-z0-9]/g, '');
  const suggestedAccount = accounts.find((account) => {
    const identity = `${account.name} ${account.bankCode ?? ''}`.toLocaleLowerCase('vi').replace(/[^a-z0-9]/g, '');
    return account.type === 'bank' && bankNeedle.length >= 3 && identity.includes(bankNeedle);
  }) ?? defaultAccount;
  let categoryId = parsed.categoryId || (parsed.type === 'income' ? INCOME_CATEGORY_ID : OTHER_CATEGORY_ID);
  let uncertain = categoryId === OTHER_CATEGORY_ID;

  const learnedRule = await matchCategorizationRule(db, { description: parsed.description });
  if (learnedRule) {
    categoryId = learnedRule.categoryId;
    uncertain = false;
  }

  const localDraft = parseExpenseText(
    `${parsed.type === 'income' ? 'nhận' : 'chi'} ${parsed.amount} ${parsed.rawBody}`,
    categories,
    new Date(parsed.occurredAtMs),
  )[0];
  if (!learnedRule && localDraft?.categoryId && !localDraft.categoryUncertain) {
    categoryId = localDraft.categoryId;
    uncertain = false;
  }

  const draft = await createInboxDraft(db, {
    source: 'bank_notification',
    sourceEventId: notification.key,
    fingerprint: parsed.fingerprint,
    status: uncertain ? 'needs_review' : 'pending',
    proposedType: parsed.type,
    amount: parsed.amount,
    categoryId,
    accountId: suggestedAccount.id,
    description: parsed.description,
    occurredAt: toLocalDateTime(new Date(parsed.occurredAtMs)),
    confidence: uncertain ? 0.55 : 0.9,
    // Raw notification text is deliberately not persisted or sent to AI.
    rawPayload: null,
  });

  return { outcome: 'pending', id: draft.id, description: draft.description, amount: draft.amount ?? parsed.amount };
}
