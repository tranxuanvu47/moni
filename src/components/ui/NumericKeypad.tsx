import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/src/components/ui/Icon';
import { AppText } from '@/src/components/ui/AppText';
import { colors, radius } from '@/src/theme/tokens';
import { formatVnd } from '@/src/utils/money';

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'del'] as const;

export function NumericKeypad({
  amount,
  onChange,
}: {
  amount: number;
  onChange: (amount: number) => void;
}) {
  function press(key: (typeof keys)[number]) {
    const digits = amount > 0 ? String(amount) : '';
    if (key === 'del') {
      onChange(Number(digits.slice(0, -1) || '0'));
      return;
    }
    const next = `${digits}${key}`.replace(/^0+(?=\d)/, '');
    if (next.length > 11) {
      return;
    }
    const value = Number(next);
    if (Number.isSafeInteger(value) && value <= 10_000_000_000) {
      onChange(value);
    }
  }

  return (
    <View>
      <AppText variant="amount" align="center" style={styles.amount}>
        {formatVnd(amount)}
      </AppText>
      <View style={styles.quick}>
        {[20000, 50000, 100000, 200000].map((value) => (
          <Pressable key={value} onPress={() => onChange(value)} style={styles.quickKey} accessibilityRole="button">
            <AppText variant="caption">{formatVnd(value).replace(' ₫', '')}</AppText>
          </Pressable>
        ))}
      </View>
      <View style={styles.grid}>
        {keys.map((key) => (
          <Pressable key={key} accessibilityRole="button" accessibilityLabel={key === 'del' ? 'Xóa' : key} onPress={() => press(key)} style={styles.key}>
            {key === 'del' ? <AppIcon name="x" color={colors.text} /> : <AppText variant="heading">{key}</AppText>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  amount: {
    marginBottom: 8,
  },
  quick: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  quickKey: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  key: {
    width: '33.33%',
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
