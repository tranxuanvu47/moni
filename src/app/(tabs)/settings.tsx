import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Header } from '@/src/components/ui/Header';
import { AppIcon } from '@/src/components/ui/Icon';
import { getDatabase } from '@/src/database/expo-client';
import { clearUserData } from '@/src/database/repositories/transactions';
import { deleteImage } from '@/src/services/images/attachments';
import { exportTransactions, importTransactions } from '@/src/services/export/backup';
import { hasApiKey } from '@/src/services/ai/secure-config';
import { useAuthSession } from '@/src/providers/auth-session';
import { readSyncSession } from '@/src/services/sync/runtime';
import { useDataStore } from '@/src/store/app-store';
import { colors } from '@/src/theme/tokens';

const rows = [
  { href: '/settings/account' as const, label: 'Tài khoản & vân tay', icon: 'user' },
  { href: '/settings/budget' as const, label: 'Ngân sách tháng', icon: 'wallet' },
  { href: '/settings/reminders' as const, label: 'Nhắc nhở', icon: 'bell' },
  { href: '/settings/bank-notifications' as const, label: 'Thông báo ngân hàng', icon: 'smartphone' },
  { href: '/settings/ai' as const, label: 'Trợ lý AI', icon: 'key-round' },
  { href: '/settings/categories' as const, label: 'Hạng mục', icon: 'list' },
  { href: '/settings/privacy' as const, label: 'Quyền riêng tư', icon: 'shield' },
  { href: '/settings/sync' as const, label: 'Đồng bộ đám mây', icon: 'cloud' },
];

export default function SettingsScreen() {
  const bump = useDataStore((state) => state.bump);
  const { email: authEmail, signOut } = useAuthSession();
  const [email, setEmail] = useState<string | null>(authEmail);
  const [aiReady, setAiReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      hasApiKey().then(setAiReady).catch(() => setAiReady(false));
      readSyncSession()
        .then((session) => setEmail(session.email ?? authEmail))
        .catch(() => setEmail(authEmail));
    }, [authEmail]),
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
      if (picked.canceled || !picked.result) {
        return;
      }
      const csv = await picked.result.text();
      const result = await importTransactions(getDatabase(), csv);
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
            .catch((error: unknown) => {
              Alert.alert('Cài đặt', error instanceof Error ? error.message : 'Không đăng xuất được.');
            })
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <Header title="Cài đặt" />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <View style={styles.info}>
            <AppText variant="caption" color={colors.textSecondary}>Tài khoản đang dùng</AppText>
            <AppText variant="bodyMedium">{email ?? '—'}</AppText>
          </View>
          <View style={[styles.logoutWrap, styles.border]}>
            <Button label="Đăng xuất" variant="secondary" disabled={busy} onPress={logout} />
          </View>
        </Card>

        <Card style={styles.card}>
          {rows.map((row, index) => (
            <Pressable key={row.href} style={[styles.row, index > 0 && styles.border]} onPress={() => router.push(row.href)}>
              <AppIcon name={row.icon} color={colors.primary} />
              <AppText style={styles.flex}>{row.label}</AppText>
              {row.href === '/settings/ai' ? (
                <AppText variant="caption" color={colors.textSecondary}>
                  {aiReady ? 'Đã gắn khóa' : 'Chưa có khóa'}
                </AppText>
              ) : null}
            </Pressable>
          ))}
        </Card>
        <Card style={styles.card}>
          <Pressable style={styles.row} onPress={() => void exportCsv()}>
            <AppIcon name="download" color={colors.primary} />
            <AppText>Xuất CSV</AppText>
          </Pressable>
          <Pressable style={[styles.row, styles.border]} onPress={() => void importCsv()}>
            <AppIcon name="upload" color={colors.primary} />
            <AppText>Nhập bản sao lưu CSV</AppText>
          </Pressable>
          <Pressable style={[styles.row, styles.border]} onPress={erase}>
            <AppIcon name="trash" color={colors.expense} />
            <AppText color={colors.expense}>Xóa toàn bộ dữ liệu</AppText>
          </Pressable>
        </Card>
        <AppText variant="caption" color={colors.textSecondary}>
          Tiền tệ mặc định: VND
        </AppText>
        <AppText variant="caption" color={colors.textSecondary}>
          Phiên bản {Constants.expoConfig?.version ?? '1.0.0'}
        </AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 16,
  },
  card: {
    padding: 0,
  },
  info: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 4,
  },
  logoutWrap: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 12,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  border: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  flex: {
    flex: 1,
  },
});
