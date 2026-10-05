import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/src/components/ui/Icon';
import { AppText } from '@/src/components/ui/AppText';
import { colors, radius } from '@/src/theme/tokens';
import type { Category, TransactionType } from '@/src/types/finance';

export const TRANSACTION_TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'expense', label: 'Chi tiêu' },
  { value: 'income', label: 'Thu nhập' },
  { value: 'transfer', label: 'Chuyển' },
];

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.item, selected && styles.itemSelected]}
          >
            <AppText variant="caption" color={selected ? colors.surface : colors.text} style={styles.itemLabel}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CategoryPicker({
  categories,
  type,
  selectedId,
  onSelect,
}: {
  categories: Category[];
  type: TransactionType;
  selectedId: string | null;
  onSelect: (category: Category) => void;
}) {
  const visible = categories.filter((category) => {
    if (type === 'transfer') {
      return category.type === 'both';
    }
    return category.type === type || category.type === 'both';
  });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {visible.map((category) => {
        const selected = category.id === selectedId;
        return (
          <Pressable
            key={category.id}
            accessibilityRole="button"
            accessibilityLabel={`Hạng mục ${category.name}`}
            accessibilityState={{ selected }}
            onPress={() => onSelect(category)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <AppIcon name={category.icon} size={16} color={selected ? colors.surface : category.color} />
            <AppText variant="caption" color={selected ? colors.surface : colors.text}>
              {category.name}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  item: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemSelected: {
    backgroundColor: colors.primary,
  },
  itemLabel: {
    fontFamily: 'Inter_500Medium',
  },
  chips: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 44,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
