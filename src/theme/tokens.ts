export const colors = {
  background: '#F8F9F6',
  surface: '#FFFFFF',
  primary: '#183D32',
  primarySoft: '#DCE9E1',
  text: '#232824',
  textSecondary: '#777F79',
  textMuted: '#626A64',
  expense: '#C36C60',
  expenseText: '#9B4D44',
  expenseSoft: '#F7ECE9',
  income: '#4C8B70',
  incomeText: '#356A53',
  divider: '#E7EAE5',
  surfaceMuted: '#F1F4F0',
  warningSoft: '#F4EEDC',
  warningText: '#745B24',
  overlay: 'rgba(35, 40, 36, 0.45)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  display: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  heading: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
  },
  bodyMedium: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
  },
  caption: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  amount: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.8,
  },
} as const;

export type TypographyVariant = keyof typeof typography;
