import { useCallback, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { getDatabase } from '@/src/database/expo-client';
import { resolveConflict } from '@/src/services/sync/local-store';
import { useAuthSession } from '@/src/providers/auth-session';
import {
  confirmFirebaseLink,
  importLegacySheets,
  readSyncSession,
  syncNow,
  type SyncSession,
} from '@/src/services/sync/runtime';
import type { SyncCycleResult } from '@/src/services/sync/types';
import { useDataStore } from '@/src/store/app-store';
import { colors } from '@/src/theme/tokens';
import { toLocalDateTime } from '@/src/utils/dates';
import { formatVnd } from '@/src/utils/money';

export default function SyncSettingsScreen() {
  const bump = useDataStore((state) => state.bump);
  const { signOut } = useAuthSession();
  const [session, setSession] = useState<SyncSession | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setSession(await readSyncSession());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          reload().catch(() => undefined);
        }
      });
      return () => sub.remove();
    }, [reload]),
  );

  async function run(action: () => Promise<void>, successMessage?: string) {
    setBusy(true);
    try {
      await action();
      bump();
      await reload();
      if (successMessage) {
        Alert.alert('Đồng bộ', successMessage);
      }
    } catch (error) {
      Alert.alert('Đồng bộ', error instanceof Error ? error.message : 'Không thực hiện được.');
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
      await reload().catch(() => undefined);
    }
  }

  const signedIn = Boolean(session?.account);
  const linked = session?.link === 'resume' && session.enabled;

  return (
    <View style={styles.screen}>
      <StackHeader title="Đồng bộ đám mây" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppText>
          Sổ trên máy vẫn dùng bình thường khi offline. Khi đã gắn tài khoản và có mạng, giao dịch mới sẽ tự đồng bộ giữa các máy.
        </AppText>
        {session?.nativeReason ? <AppText color={colors.expense}>{session.nativeReason}</AppText> : null}
        <AppText variant="bodyMedium">{signedIn ? session?.email : 'Chưa đăng nhập'}</AppText>
        <AppText color={colors.textSecondary}>
          Lần đồng bộ gần nhất: {session?.lastSuccessAt ? session.lastSuccessAt.replace('T', ' ') : 'chưa có'}
        </AppText>
        {session?.lastError ? (
          <>
            <AppText color={colors.expense}>{session.lastError}</AppText>
            {(session.pendingTransactions ?? 0) > 0 ? (
              <AppText color={colors.expense}>
                Giao dịch đang chờ đồng bộ: {session.pendingTransactions}. Bấm Đồng bộ ngay để thử lại.
              </AppText>
            ) : null}
          </>
        ) : null}
        {session?.lastWarning && !session?.lastError ? (
          <AppText color={colors.textSecondary}>{session.lastWarning}</AppText>
        ) : null}

        {session?.link === 'confirm' ? (
          <View style={styles.block}>
            <AppText>
              Máy này đang có {session.localTransactions} giao dịch. Chúng chỉ được tải lên sau khi bạn xác nhận gắn với {session.email}.
            </AppText>
            <Button
              label="Gắn dữ liệu máy với tài khoản này"
              disabled={busy}
              loading={busy}
              onPress={() =>
                void run(confirmFirebaseLink, 'Đã gắn tài khoản. Nếu còn giao dịch chờ, bấm Đồng bộ ngay.')
              }
            />
          </View>
        ) : null}
        {session?.link === 'blocked' ? (
          <AppText color={colors.expense}>
            Tài khoản vừa đăng nhập khác với tài khoản đã gắn trên máy. Dữ liệu máy không được gộp sang tài khoản này.
          </AppText>
        ) : null}

        {!signedIn ? (
          <Button label="Đăng nhập / tạo tài khoản" onPress={() => router.push('/settings/account')} />
        ) : null}

        <Button
          label="Đồng bộ ngay"
          onPress={() =>
            void run(async () => {
              explainSync(await syncNow(true));
            }, 'Đồng bộ xong.')
          }
          loading={busy && linked}
          disabled={!linked || busy}
        />

        {signedIn ? (
          <Button
            label="Đăng xuất"
            variant="secondary"
            disabled={busy}
            onPress={() => {
              Alert.alert('Đăng xuất', 'Dữ liệu trên máy và bản đã đồng bộ vẫn được giữ. Bạn cần đăng nhập lại để tiếp tục dùng app.', [
                { text: 'Ở lại', style: 'cancel' },
                { text: 'Đăng xuất', style: 'destructive', onPress: () => void run(signOut) },
              ]);
            }}
          />
        ) : null}

        <Button
          label="Nhập một lần từ Google Sheets"
          variant="secondary"
          disabled={busy || !session?.sheetsReady}
          onPress={() => void run(async () => {
            const report = await importLegacySheets();
            Alert.alert(
              'Đã nhập từ Sheets',
              `Thêm ${report.inserted} dòng, giữ nguyên ${report.alreadyPresent} dòng đã có cùng ID, bỏ qua ${report.skipped}. Sheets: ${report.sheet.count} giao dịch, thu ${formatVnd(report.sheet.income)}, chi ${formatVnd(report.sheet.expense)}. Trên máy: ${report.local.count} giao dịch, thu ${formatVnd(report.local.income)}, chi ${formatVnd(report.local.expense)}. File Sheets không bị xóa.`,
            );
          })}
        />
        {session?.sheetsReason ? <AppText variant="caption" color={colors.textSecondary}>{session.sheetsReason}</AppText> : null}

        {session?.conflicts.map((conflict) => (
          <View key={`${conflict.entity}:${conflict.id}`} style={styles.block}>
            <AppText variant="bodyMedium">{conflictTitle(conflict)}</AppText>
            <AppText color={colors.textSecondary}>Hai máy cùng sửa dòng này. Chọn bản muốn giữ.</AppText>
            <Button
              label="Giữ bản trên máy"
              variant="secondary"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await resolveConflict(getDatabase(), conflict.entity, conflict.id, 'local', toLocalDateTime(new Date()));
                  explainSync(await syncNow(true));
                })
              }
            />
            <Button
              label="Dùng bản trên đám mây"
              variant="ghost"
              disabled={busy || !conflict.remote}
              onPress={() =>
                void run(async () => {
                  await resolveConflict(getDatabase(), conflict.entity, conflict.id, 'remote', toLocalDateTime(new Date()));
                })
              }
            />
          </View>
        ))}
        <AppText variant="caption" color={colors.textSecondary}>
          Ảnh hóa đơn vẫn nằm trên máy; bản này chưa đồng bộ ảnh lên đám mây.
        </AppText>
      </ScrollView>
    </View>
  );
}

function explainSync(result: SyncCycleResult): void {
  if (result.outcome === 'offline') {
    throw new Error('Điện thoại đang offline. Thay đổi vẫn nằm trên máy và sẽ đồng bộ khi có mạng.');
  }
  if (result.outcome === 'error') {
    throw new Error(result.message);
  }
  if (result.outcome === 'disabled') {
    throw new Error('Chưa gắn tài khoản để đồng bộ.');
  }
  if (result.outcome === 'waiting') {
    throw new Error(result.nextAttemptAt ? `Sẽ thử lại sau ${result.nextAttemptAt.replace('T', ' ')}.` : 'Đang đồng bộ. Hãy đợi xong lượt này.');
  }
}

function conflictTitle(conflict: SyncSession['conflicts'][number]): string {
  const local = conflict.local.fields;
  const remote = conflict.remote?.fields;
  const name = local.description || local.name || local.value || conflict.id;
  if (!remote) {
    return `${name}: bản trên đám mây không còn dòng này`;
  }
  if (conflict.entity === 'transactions') {
    return `${name}: máy ${formatVnd(Number(local.amount))} · đám mây ${formatVnd(Number(remote.amount))}`;
  }
  return name;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  block: { gap: 8 },
});
