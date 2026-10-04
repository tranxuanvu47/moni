import { StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { colors } from '@/src/theme/tokens';

export default function NotFoundScreen() {
  return (
    <View style={styles.screen}>
      <AppText variant="heading">Không thấy màn hình này</AppText>
      <Link href="/" style={styles.link}>
        <AppText color={colors.primary}>Về tổng quan</AppText>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  link: {
    padding: 8,
  },
});
