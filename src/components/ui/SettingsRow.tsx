import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/src/components/ui/Icon';
import { AppText } from '@/src/components/ui/AppText';
import { colors } from '@/src/theme/tokens';

export function SettingsRow({
  label,
  icon,
  detail,
  onPress,
  destructive = false,
  showChevron = true,
}: {
  label: string;
  icon: string;
  detail?: string | null;
  onPress?: () => void;
  destructive?: boolean;
  showChevron?: boolean;
}) {
  const color = destructive ? colors.expenseText : colors.primary;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityHint={onPress ? 'Mở mục cài đặt' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <AppIcon name={icon} color={color} size={19} />
      </View>
      <AppText color={destructive ? colors.expenseText : colors.text} style={styles.label}>{label}</AppText>
      {detail ? <AppText variant="caption" color={destructive ? colors.expenseText : colors.textMuted} numberOfLines={1} style={styles.detail}>{detail}</AppText> : null}
      {showChevron && onPress ? <AppIcon name="chevron-right" color={colors.textMuted} size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  icon: { width: 28, alignItems: 'center' },
  label: { flex: 1 },
  detail: { maxWidth: '42%' },
  pressed: { opacity: 0.65 },
});
