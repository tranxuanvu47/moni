import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, typography, type TypographyVariant } from '@/src/theme/tokens';

interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: string;
  align?: TextStyle['textAlign'];
}

export function AppText({ variant = 'body', color = colors.text, align, style, ...rest }: AppTextProps) {
  return <Text {...rest} style={[typography[variant], { color, textAlign: align }, style]} />;
}
