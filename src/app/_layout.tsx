import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BiometricUnlock } from '@/src/components/auth/BiometricUnlock';
import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { getDatabase, initDatabase } from '@/src/database/expo-client';
import { migrate } from '@/src/database/migrate';
import { materializeRecurringTransactions } from '@/src/database/repositories/recurring';
import { AuthSessionProvider, useAuthSession } from '@/src/providers/auth-session';
import { startBankNotificationRuntime } from '@/src/services/bank/runtime';
import { syncInboxBadgeCount } from '@/src/services/notifications/inbox-alerts';
import { startSyncRuntime } from '@/src/services/sync/runtime';
import { syncScheduledReminders } from '@/src/services/notifications/reminders';
import { useDataStore } from '@/src/store/app-store';
import { colors } from '@/src/theme/tokens';
import { formatIsoDate, localDateFromDate } from '@/src/utils/dates';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={styles.center}>
      <AppText variant="heading">Không mở được màn hình</AppText>
      <AppText color={colors.textSecondary}>{error.message}</AppText>
      <Button label="Thử lại" onPress={retry} />
    </View>
  );
}

export default function RootLayout() {
  const revision = useDataStore((state) => state.revision);
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let stopSync = () => {};
    let stopBank = () => {};
    let cancelled = false;

    async function prepare() {
      const db = await initDatabase();
      await migrate(db);
      if (cancelled) {
        return;
      }

      setReady(true);
      await syncInboxBadgeCount(db).catch(() => undefined);
      // Keep startup lean: render from local SQLite first, then refresh derived/background data.
      stopBank = startBankNotificationRuntime();

      void (async () => {
        const created = await materializeRecurringTransactions(db, formatIsoDate(localDateFromDate(new Date()))).catch(() => []);
        if (created.length > 0) {
          useDataStore.getState().bump();
        }
        await syncScheduledReminders().catch(() => undefined);
        if (cancelled) {
          return;
        }
        stopSync = startSyncRuntime();
      })();
    }

    prepare().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'Không mở được sổ chi tiêu.');
    });

    return () => {
      cancelled = true;
      stopSync();
      stopBank();
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    syncInboxBadgeCount(getDatabase()).catch(() => undefined);
  }, [ready, revision]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (url === '/settings/inbox') {
        router.push('/settings/inbox');
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontError, fontsLoaded]);

  if (message) {
    return (
      <View style={styles.center}>
        <AppText variant="heading">AiTiMan Moni chưa mở được</AppText>
        <AppText color={colors.textSecondary}>{message}</AppText>
      </View>
    );
  }

  if ((!fontsLoaded && !fontError) || !ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <AppText variant="caption" color={colors.textMuted}>Đang mở sổ chi tiêu</AppText>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthSessionProvider>
        <RootNavigator />
      </AuthSessionProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { status, email, markUnlocked, signOut } = useAuthSession();

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (status === 'needs_biometric' && email) {
    return (
      <BiometricUnlock
        email={email}
        onUnlocked={markUnlocked}
        onUsePassword={() => {
          void signOut();
        }}
      />
    );
  }

  const signedIn = status === 'ready';

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="transaction/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="transaction/preview" options={{ presentation: 'modal' }} />
        <Stack.Screen name="transaction/camera" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="transaction/[id]" />
        <Stack.Screen name="settings/account" />
        <Stack.Screen name="settings/accounts" />
        <Stack.Screen name="settings/inbox" />
        <Stack.Screen name="settings/budget" />
        <Stack.Screen name="settings/reminders" />
        <Stack.Screen name="settings/bank-notifications" />
        <Stack.Screen name="settings/ai" />
        <Stack.Screen name="settings/categories" />
        <Stack.Screen name="settings/recurring" />
        <Stack.Screen name="settings/categorization-rules" />
        <Stack.Screen name="settings/privacy" />
        <Stack.Screen name="settings/sync" />
        <Stack.Screen name="account/[id]" />
      </Stack.Protected>

      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
});
