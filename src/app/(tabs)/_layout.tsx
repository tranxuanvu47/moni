import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Tabs, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/src/components/ui/Icon';
import { AppText } from '@/src/components/ui/AppText';
import { getDatabase } from '@/src/database/expo-client';
import { countReviewableInboxDrafts } from '@/src/database/repositories/inbox';
import { useDataStore } from '@/src/store/app-store';
import { colors } from '@/src/theme/tokens';

interface TabButtonProps {
  children: ReactNode;
  accessibilityState?: { selected?: boolean };
}

export default function TabLayout() {
  const revision = useDataStore((state) => state.revision);
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);
  const [inboxCount, setInboxCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      void revision;
      let active = true;
      countReviewableInboxDrafts(getDatabase())
        .then((count) => {
          if (active) setInboxCount(count);
        })
        .catch(() => {
          if (active) setInboxCount(0);
        });
      return () => {
        active = false;
      };
    }, [revision]),
  );

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.divider,
            height: 66 + bottom,
            paddingTop: 6,
            paddingBottom: bottom,
          },
          tabBarLabelStyle: {
            fontFamily: 'Inter_500Medium',
            fontSize: 11,
            lineHeight: 15,
          },
          tabBarItemStyle: { minHeight: 54 },
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
          name="new"
          options={{
            title: 'Thêm',
            tabBarLabel: '',
            tabBarButton: (props) => <AddTabButton {...props} />,
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
        <Tabs.Screen
          name="inbox"
          options={{
            href: null,
          }}
        />
      </Tabs>
      {inboxCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Hộp chờ giao dịch, ${inboxCount} cần kiểm tra`}
          onPress={() => router.push('/settings/inbox')}
          style={({ pressed }) => [styles.inboxPill, { bottom: 74 + bottom }, pressed && styles.pressed]}
        >
          <AppIcon name="inbox" color={colors.surface} size={18} />
          <AppText variant="caption" color={colors.surface} style={styles.inboxText}>
            {formatBadgeCount(inboxCount)} giao dịch cần kiểm tra
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function AddTabButton({ children, accessibilityState }: TabButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Thêm giao dịch"
      accessibilityState={accessibilityState}
      onPress={() => {
        router.push('/transaction/new');
      }}
      style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
    >
      <View style={styles.addHalo}>
        <View style={styles.addCircle}>
          <AppIcon name="plus" color={colors.surface} size={24} />
        </View>
      </View>
      <View style={styles.hiddenChildren}>{children}</View>
    </Pressable>
  );
}

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  addButton: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addHalo: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    shadowColor: colors.text,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  inboxPill: {
    position: 'absolute',
    left: 20,
    right: 20,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    shadowColor: colors.text,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  inboxText: {
    fontFamily: 'Inter_500Medium',
  },
  addCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenChildren: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
});
