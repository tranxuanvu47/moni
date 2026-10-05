import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { AppIcon } from '@/src/components/ui/Icon';
import { AppText } from '@/src/components/ui/AppText';
import { colors } from '@/src/theme/tokens';

export function Header({ title, right }: { title: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.row, { paddingTop: insets.top + 8 }]}>
      <AppText variant="title">{title}</AppText>
      {right}
    </View>
  );
}

export function StackHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.stack, { paddingTop: insets.top + 8 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" hitSlop={8} onPress={() => router.back()} style={styles.back}>
        <AppIcon name="chevron-left" color={colors.text} size={22} />
      </Pressable>
      <AppText variant="heading">{title}</AppText>
    </View>
  );
}

export function AddButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Thêm giao dịch"
      onPress={() => router.push('/transaction/new')}
      style={({ pressed }) => [styles.add, pressed && styles.pressed]}
    >
      <AppIcon name="plus" color={colors.primary} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stack: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  back: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
  },
});
