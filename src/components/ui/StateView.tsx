import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { colors } from '@/src/theme/tokens';

export function LoadingState({ label = 'Đang tải dữ liệu' }: { label?: string }) {
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <ActivityIndicator accessibilityLabel={label} color={colors.primary} />
      <AppText variant="caption" color={colors.textMuted}>{label}</AppText>
    </View>
  );
}

export function MessageState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <AppText variant="heading" align="center">{title}</AppText>
      {message ? <AppText color={colors.textMuted} align="center">{message}</AppText> : null}
      {actionLabel && onAction ? <Button label={actionLabel} variant="secondary" onPress={onAction} style={styles.button} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  state: {
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  button: { marginTop: 8, alignSelf: 'stretch' },
});
