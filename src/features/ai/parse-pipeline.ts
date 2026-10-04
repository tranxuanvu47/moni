import { localParseIsComplete, parseExpenseText } from '@/src/features/ai/local-parser';
import { validateAiTransactions } from '@/src/features/ai/validate-draft';
import type { Category, TransactionDraft } from '@/src/types/finance';
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
    describeError?: (error: unknown) => string;
  },
): Promise<ParseResult> {
  const local = parseExpenseText(text, options.categories, options.now);
  const today = formatIsoDate(localDateFromDate(options.now));
  const complete = localParseIsComplete(local);

  if (!options.forceAi && (complete || !options.allowAi || !options.ai)) {
    return {
      drafts: local,
      source: 'local',
      notice: complete
        ? 'Đã tách trên máy, không gửi nội dung đi.'
        : options.allowAi && !options.ai
          ? 'Một số khoản chưa rõ. Bạn có thể sửa tay. Bản build chưa có khóa AI để đọc câu phức tạp.'
          : undefined,
    };
  }

  if (!options.ai) {
    return {
      drafts: local,
      source: 'local',
      notice: 'Bản build chưa có khóa AI. Hãy kiểm tra và sửa các khoản bên dưới.',
    };
  }

  try {
    const payload = await options.ai.parseExpenseText(
      text,
      today,
      options.categories.map((category) => category.name),
    );
    const drafts = validateAiTransactions(payload, options.categories, today);
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
