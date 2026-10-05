import { formatPercent, formatVnd } from '@/src/utils/money';

export interface InsightInput {
  expenseTotal: number;
  transactionCount: number;
  topCategoryName?: string;
  topCategoryShare?: number;
  budgetAmount?: number | null;
  budgetSpent?: number;
  changeText?: string;
  changeDirection?: 'up' | 'down' | 'flat' | 'na';
}

export function buildLocalInsight(input: InsightInput): string {
  if (input.expenseTotal <= 0 || input.transactionCount === 0) {
    return 'Chưa có chi tiêu trong kỳ này.';
  }

  if (input.transactionCount < 3) {
    return `Mới có ${input.transactionCount} giao dịch, tổng ${formatVnd(input.expenseTotal)}. Thêm vài khoản nữa để thấy thói quen rõ hơn.`;
  }

  if (input.budgetAmount && input.budgetAmount > 0 && input.budgetSpent != null) {
    const ratio = input.budgetSpent / input.budgetAmount;
    if (ratio >= 1) {
      return `Bạn đã dùng hết ngân sách tháng (${formatPercent(ratio)}).`;
    }
    if (ratio >= 0.8) {
      return `Bạn đã sử dụng ${formatPercent(ratio)} ngân sách tháng.`;
    }
  }

  if (input.topCategoryName && input.topCategoryShare != null && input.topCategoryShare >= 0.25) {
    return `Chi tiêu ${input.topCategoryName.toLocaleLowerCase('vi')} đang chiếm ${formatPercent(input.topCategoryShare)} tổng chi tiêu kỳ này.`;
  }

  if (input.changeText && input.changeDirection && input.changeDirection !== 'na' && input.changeDirection !== 'flat') {
    return `Chi tiêu kỳ này ${input.changeText.charAt(0).toLocaleLowerCase('vi')}${input.changeText.slice(1)}.`;
  }

  return `Kỳ này có ${input.transactionCount} giao dịch chi, tổng ${formatVnd(input.expenseTotal)}.`;
}

export interface InsightPayload {
  periodLabel: string;
  expenseTotal: number;
  incomeTotal: number;
  previousExpenseTotal: number;
  comparisonNote: string;
  topCategories: { name: string; amount: number; share: number }[];
  budgetAmount: number | null;
  budgetSpent: number;
  budgetRemaining: number | null;
  budgetRatio: number | null;
  budgetLevel: 'ok' | 'warning' | 'exceeded' | 'unset' | null;
  transactionCount: number;
  averageDaily: number;
  categoryBudgets: {
    name: string;
    amount: number;
    spent: number;
    remaining: number;
    ratio: number;
    level: 'ok' | 'warning' | 'exceeded' | 'unset';
    warningThresholdPercent: number;
    limitThresholdPercent: number;
  }[];
}

export function insightCacheKey(payload: InsightPayload): string {
  return JSON.stringify(payload);
}
