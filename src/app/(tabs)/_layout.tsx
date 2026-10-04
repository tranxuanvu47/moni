import { Tabs } from 'expo-router';

import { AppIcon } from '@/src/components/ui/Icon';
import { colors } from '@/src/theme/tokens';

export default function TabLayout() {
  const bottom = 8;

  return (
    <Tabs
      safeAreaInsets={{ bottom: 0 }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          height: 56 + bottom,
          paddingTop: 6,
          paddingBottom: bottom,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Tổng quan',
          tabBarIcon: ({ color, size }) => <AppIcon name="chart-column" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Giao dịch',
          tabBarIcon: ({ color, size }) => <AppIcon name="list" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Thống kê',
          tabBarIcon: ({ color, size }) => <AppIcon name="chart-pie" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Cài đặt',
          tabBarIcon: ({ color, size }) => <AppIcon name="settings" color={String(color)} size={size} />,
        }}
      />
    </Tabs>
  );
}
