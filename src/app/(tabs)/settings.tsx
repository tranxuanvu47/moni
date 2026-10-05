import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Header } from '@/src/components/ui/Header';
import { SettingsRow } from '@/src/components/ui/SettingsRow';
import { getDatabase } from '@/src/database/expo-client';
import { clearUserData } from '@/src/database/repositories/transactions';
import { useAuthSession } from '@/src/providers/auth-session';
import { hasApiKey } from '@/src/services/ai/secure-config';
import { exportTransactions, importTransactions } from '@/src/services/export/backup';
import { deleteImage } from '@/src/services/images/attachments';
import { readSyncSession, type SyncSession } from '@/src/services/sync/runtime';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';

export default function SettingsScreen() {
  const bump = useDataStore((state) => state.bump);
  const { email: authEmail, signOut } = useAuthSession();
  const [session, setSession] = useState<SyncSession | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([hasApiKey(), readSyncSession()])
        .then(([nextAiReady, nextSession]) => {
          if (!active) return;
          setAiReady(nextAiReady);
          setSession(nextSession);
        })
        .catch(() => {
          if (active) setAiReady(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  async function exportCsv() {
    try {
      await exportTransactions(getDatabase());
    } catch (error) {
      Alert.alert('Xuất dữ liệu', error instanceof Error ? error.message : 'Không xuất được tệp.');
    }
  }

  async function importCsv() {
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ['text/csv', 'text/comma-separated-values', 'text/plain', 'text/*'] });
      if (picked.canceled || !picked.result) return;
      const result = await importTransactions(getDatabase(), await picked.result.text());
      bump();
      Alert.alert('Nhập dữ liệu', `Đã nhập ${result.imported} giao dịch. Bỏ qua ${result.skipped}.`);
    } catch (error) {
      Alert.alert('Nhập dữ liệu', error instanceof Error ? error.message : 'Không đọc được tệp.');
    }
  }

  function erase() {
    Alert.alert(
      'Xóa toàn bộ dữ liệu',
      'Giao dịch, ảnh, ngân sách và tùy chọn trên máy này sẽ bị xóa. Bản đã đồng bộ trên đám mây không bị xóa theo.',
      [
        { text: 'Giữ lại', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const files = await clearUserData(getDatabase());
              files.forEach((uri) => deleteImage(uri));
              bump();
            })();
          },
        },
      ],
    );
  }

  function logout() {
    Alert.alert('Đăng xuất', 'Dữ liệu trên máy vẫn được giữ. Bạn cần đăng nhập lại để tiếp tục dùng app.', [
      { text: 'Ở lại', style: 'cancel' },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void signOut()
            .catch((error: unknown) => Alert.alert('Cài đặt', error instanceof Error ? error.message : 'Không đăng xuất được.'))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  const email = session?.email ?? authEmail;

  return (
    <View style={styles.screen}>
      <Header title="Cài đặt" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.accountSummary} accessible accessibilityLabel={`Tài khoản đang dùng ${email ?? 'chưa xác định'}`}>
          <View style={styles.accountCopy}>
            <AppText variant="caption" color={colors.textMuted}>Tài khoản đang dùng</AppText>
            <AppText variant="bodyMedium" numberOfLines={1}>{email ?? 'Chưa xác định'}</AppText>
          </View>
          <AppText variant="caption" color={syncColor(session)}>{syncSummary(session)}</AppText>
        </View>

        <SettingsGroup title="Tài chính">
          <SettingsRow label="Tài khoản & ví" icon="wallet" onPress={() => router.push('/settings/accounts')} />
          <SettingsRow label="Ngân sách" icon="wallet" onPress={() => router.push('/settings/budget')} />
          <SettingsRow label="Hạng mục" icon="list" onPress={() => router.push('/settings/categories')} />
          <SettingsRow label="Giao dịch định kỳ" icon="calendar" onPress={() => router.push('/settings/recurring' as never)} />
        </SettingsGroup>

        <SettingsGroup title="Tự động hóa">
          <SettingsRow label="Thông báo ngân hàng" icon="smartphone" onPress={() => router.push('/settings/bank-notifications')} />
          <SettingsRow label="Trợ lý AI" icon="key-round" detail={aiReady == null ? 'Đang kiểm tra' : aiReady ? 'Sẵn sàng' : 'Chưa cấu hình'} onPress={() => router.push('/settings/ai')} />
          <SettingsRow label="Quy tắc phân loại" icon="list" onPress={() => router.push('/settings/categorization-rules' as never)} />
          <SettingsRow label="Nhắc nhở" icon="bell" onPress={() => router.push('/settings/reminders')} />
        </SettingsGroup>

        <SettingsGroup title="Dữ liệu">
          <SettingsRow label="Đồng bộ Firebase" icon="cloud" detail={syncSummary(session)} onPress={() => router.push('/settings/sync')} />
          <SettingsRow label="Xuất CSV" icon="download" showChevron={false} onPress={() => void exportCsv()} />
          <SettingsRow label="Nhập CSV" icon="upload" showChevron={false} onPress={() => void importCsv()} />
        </SettingsGroup>

        <SettingsGroup title="Ứng dụng">
          <SettingsRow label="Đăng nhập & bảo mật" icon="user" onPress={() => router.push('/settings/account')} />
          <SettingsRow label="Quyền riêng tư" icon="shield" onPress={() => router.push('/settings/privacy')} />
          <SettingsRow label="Phiên bản" icon="smartphone" detail={Constants.expoConfig?.version ?? '1.0.0'} showChevron={false} />
        </SettingsGroup>

        <View style={styles.destructive}>
          <SettingsRow label="Đăng xuất" icon="user" detail={busy ? 'Đang đăng xuất' : null} destructive showChevron={false} onPress={busy ? undefined : logout} />
          <SettingsRow label="Xóa toàn bộ dữ liệu" icon="trash" destructive showChevron={false} onPress={erase} />
        </View>
      </ScrollView>
    </View>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <AppText variant="label" color={colors.textMuted}>{title}</AppText>
      <View style={styles.rows}>{children}</View>
    </View>
  );
}

function syncSummary(session: SyncSession | null): string {
  if (!session) return 'Đang kiểm tra';
  if (session.lastError) return 'Cần kiểm tra';
  if (!session.enabled || !session.email) return 'Chưa bật';
  if (session.pendingTransactions > 0) return `${session.pendingTransactions} thay đổi đang chờ`;
  if (session.lastSuccessAt) {
    const time = new Date(session.lastSuccessAt);
    if (!Number.isNaN(time.getTime())) return `Đã đồng bộ ${time.toLocaleDateString('vi-VN')}`;
  }
  return 'Sẵn sàng đồng bộ';
}

function syncColor(session: SyncSession | null): string {
  if (session?.lastError) return colors.expenseText;
  if (session?.enabled && session.email) return colors.incomeText;
  return colors.textMuted;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 24 },
  accountSummary: { minHeight: 68, backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountCopy: { flex: 1, gap: 3 },
  group: { gap: 6 },
  rows: { borderTopWidth: 1, borderTopColor: colors.divider },
  destructive: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 8 },
});
