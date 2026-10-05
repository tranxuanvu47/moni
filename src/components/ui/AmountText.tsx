import { StyleSheet, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { colors } from '@/src/theme/tokens';
import type { TransactionType } from '@/src/types/finance';

export function AmountText({ amount, type, size = 'md' }: { amount: number; type?: TransactionType; size?: 'md' | 'lg' }) {
  const color = type === 'income' ? colors.incomeText : type === 'expense' ? colors.expenseText : colors.text;
  const prefix = type === 'expense' ? '−' : type === 'income' ? '+' : '';
  return (
    <AppText variant={size === 'lg' ? 'amount' : 'heading'} color={color} style={size === 'md' ? styles.md : undefined}>
      {prefix}
      {format(amount)}
    </AppText>
  );
}

function format(amount: number): string {
  const absolute = Math.abs(Math.trunc(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${absolute} ₫`;
}

export function ProgressBar({ ratio }: { ratio: number }) {
  const width = Math.max(0, Math.min(ratio, 1)) * 100;
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityLabel="Tiến độ ngân sách"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(width), text: `${Math.round(width)} phần trăm` }}
    >
      <View style={[styles.fill, { width: `${width}%` }, ratio >= 1 && styles.over]} />
    </View>
  );
}

const styles = StyleSheet.create({
  md: {
    fontSize: 15,
    lineHeight: 20,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primarySoft,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  over: {
    backgroundColor: colors.expense,
  },
});
