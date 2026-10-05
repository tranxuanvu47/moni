import { localParseIsComplete, parseExpenseText } from '@/src/features/ai/local-parser';
import { validateAiTransactions } from '@/src/features/ai/validate-draft';
import type { CategorizationRule, Category, TransactionDraft } from '@/src/types/finance';
import { formatIsoDate, localDateFromDate } from '@/src/utils/dates';

export interface ExpenseParser {
  parseExpenseText(text: string, today: string, categoryNames: string[]): Promise<unknown>;
}

export interface ParseResult {
  drafts: TransactionDraft[];
  source: 'local' | 'ai';
  notice?: string;
}

export async function parseExpenseInput(
  text: string,
  options: {
    now: Date;
    categories: Category[];
    allowAi: boolean;
    forceAi?: boolean;
    ai?: ExpenseParser | null;
    matchCategoryRule?: (input: { description: string; merchant?: string | null }) => Promise<CategorizationRule | null>;
    describeError?: (error: unknown) => string;
  },
): Promise<ParseResult> {
  const local = await applyCategoryRules(parseExpenseText(text, options.categories, options.now), options);
  const today = formatIsoDate(localDateFromDate(options.now));
  const complete = localParseIsComplete(local);

  if (!options.forceAi && (complete || !options.allowAi || !options.ai)) {
    return {
      drafts: local,
      source: 'local',
      notice: complete
        ? 'Đã tách trên máy, không gửi nội dung đi.'
        : options.allowAi && !options.ai
          ? 'Một số khoản chưa rõ. Bạn có thể sửa tay hoặc thêm khóa AI trong Cài đặt.'
          : undefined,
    };
  }

  if (!options.ai) {
    return {
      drafts: local,
      source: 'local',
      notice: 'Chưa có khóa AI. Hãy kiểm tra và sửa các khoản bên dưới.',
    };
  }

  try {
    const payload = await options.ai.parseExpenseText(
      text,
      today,
      options.categories.map((category) => category.name),
    );
    const drafts = await applyCategoryRules(validateAiTransactions(payload, options.categories, today), options);
    return { drafts, source: 'ai', notice: 'AI đã đọc câu của bạn. Hãy kiểm tra trước khi lưu.' };
  } catch (error) {
    const message = options.describeError?.(error) ?? 'Không phân tích được bằng AI.';
    return {
      drafts: local,
      source: 'local',
      notice: `${message} Đang hiển thị kết quả tách trên máy.`,
    };
  }
}

async function applyCategoryRules(
  drafts: TransactionDraft[],
  options: {
    categories: Category[];
    matchCategoryRule?: (input: { description: string; merchant?: string | null }) => Promise<CategorizationRule | null>;
  },
): Promise<TransactionDraft[]> {
  if (!options.matchCategoryRule) return drafts;
  return Promise.all(drafts.map(async (draft) => {
    const rule = await options.matchCategoryRule?.({ description: draft.description });
    if (!rule) return draft;
    const category = options.categories.find((item) => item.id === rule.categoryId);
    if (!category) return draft;
    return {
      ...draft,
      categoryId: category.id,
      categoryName: category.name,
      categoryUncertain: false,
      type: category.type === 'income' ? 'income' : draft.type,
    };
  }));
}
