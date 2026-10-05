import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { LoadingState, MessageState } from '@/src/components/ui/StateView';
import { TransactionRow } from '@/src/components/ui/TransactionRow';
import { getDatabase } from '@/src/database/expo-client';
import { getAccount, getAccountBalance, reconcileAccount } from '@/src/database/repositories/accounts';
import { listTransactions } from '@/src/database/repositories/transactions';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Account, TransactionListItem } from '@/src/types/finance';
import { toLocalDateTime } from '@/src/utils/dates';
import { formatVnd } from '@/src/utils/money';

export default function AccountDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = String(params.id ?? '');
  const revision = useDataStore((state) => state.revision);
  const bump = useDataStore((state) => state.bump);
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState<Account | null>(null);
  const [balance, setBalance] = useState(0);
  const [items, setItems] = useState<TransactionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [actual, setActual] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const db = getDatabase();
      const [nextAccount, nextBalance, nextItems] = await Promise.all([
        getAccount(db, id),
        getAccountBalance(db, id),
        listTransactions(db, { accountId: id, limit: 100, offset: 0 }),
      ]);
      setAccount(nextAccount);
      setBalance(nextBalance);
      setItems(nextItems);
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Không tải được tài khoản.');
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void revision; void load(); }, [load, revision]));

  async function saveReconciliation() {
    const value = Number(actual.replace(/\D/g, ''));
    if (!Number.isSafeInteger(value)) return;
    setBusy(true);
    try {
      await reconcileAccount(getDatabase(), {
        accountId: id,
        actualBalance: value,
        occurredAt: toLocalDateTime(new Date()),
      });
      setReconcileOpen(false);
      setActual('');
      bump();
      await load();
    } catch (next) {
      Alert.alert('Đối soát', next instanceof Error ? next.message : 'Không lưu được điều chỉnh.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StackHeader title={account?.name ?? 'Tài khoản'} />
      {!account && !error ? <LoadingState label="Đang tải tài khoản" /> : null}
      {error && !account ? <MessageState title="Chưa tải được tài khoản" message={error} actionLabel="Thử lại" onAction={() => void load()} /> : null}
      {account ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summary}>
            <AppText variant="caption" color={colors.textMuted}>Số dư ước tính</AppText>
            <AppText variant="display">{formatVnd(balance)}</AppText>
            <AppText variant="caption" color={colors.textMuted}>Số dư đầu kỳ {formatVnd(account.openingBalance)}</AppText>
          </View>
          <Button label="Đối soát số dư" variant="secondary" onPress={() => { setActual(String(Math.max(balance, 0))); setReconcileOpen(true); }} />
          <View style={styles.section}>
            <AppText variant="heading">Lịch sử giao dịch</AppText>
            {items.length ? items.map((item) => <TransactionRow key={item.id} item={item} onPress={(transactionId) => router.push(`/transaction/${transactionId}`)} />) : <AppText color={colors.textMuted}>Chưa có giao dịch trong tài khoản này.</AppText>}
          </View>
        </ScrollView>
      ) : null}

      <Modal visible={reconcileOpen} transparent animationType="slide" onRequestClose={() => setReconcileOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.dismiss} accessibilityLabel="Đóng" onPress={() => setReconcileOpen(false)} />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <AppText variant="title">Đối soát số dư</AppText>
            <AppText color={colors.textMuted}>Nhập số dư thực tế. Phần chênh lệch được lưu thành điều chỉnh có thể kiểm tra, không biến thành khoản chi giả.</AppText>
            <TextInput value={actual} onChangeText={setActual} keyboardType="number-pad" accessibilityLabel="Số dư thực tế" style={styles.input} autoFocus />
            <Button label="Lưu điều chỉnh" onPress={() => void saveReconciliation()} loading={busy} disabled={!actual.trim()} />
            <Button label="Hủy" variant="ghost" onPress={() => setReconcileOpen(false)} disabled={busy} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 20 },
  summary: { gap: 5 },
  section: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 16, gap: 8 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: 12, color: colors.text, fontFamily: 'Inter_400Regular', fontSize: 18 },
});
