import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AmountText } from '@/src/components/ui/AmountText';
import { AppIcon } from '@/src/components/ui/Icon';
import { AppText } from '@/src/components/ui/AppText';
import { colors, radius } from '@/src/theme/tokens';
import type { TransactionListItem } from '@/src/types/finance';
import { formatTime } from '@/src/utils/dates';

function TransactionRowComponent({ item, onPress }: { item: TransactionListItem; onPress: (id: string) => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => onPress(item.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.icon}>
        <AppIcon name={item.categoryIcon} size={18} color={item.categoryColor} />
      </View>
      <View style={styles.copy}>
        <AppText variant="bodyMedium" numberOfLines={1}>
          {item.description || item.categoryName}
        </AppText>
        <AppText variant="caption" color={colors.textSecondary}>
          {item.categoryName} · {formatTime(item.occurredAt)}
        </AppText>
      </View>
      <View style={styles.amount}>
        <AmountText amount={item.amount} type={item.type} />
        {item.attachmentCount > 0 ? <AppIcon name="paperclip" size={14} color={colors.textSecondary} /> : null}
      </View>
    </Pressable>
  );
}

export const TransactionRow = memo(TransactionRowComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  pressed: {
    opacity: 0.7,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  amount: {
    alignItems: 'flex-end',
    gap: 4,
  },
});
