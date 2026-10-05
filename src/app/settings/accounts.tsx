import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { AppIcon } from '@/src/components/ui/Icon';
import { SegmentedControl } from '@/src/components/ui/Pickers';
import { LoadingState, MessageState } from '@/src/components/ui/StateView';
import { getDatabase } from '@/src/database/expo-client';
import {
  createAccount,
  listAccounts,
  setAccountArchived,
  updateAccount,
  type AccountInput,
} from '@/src/database/repositories/accounts';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { AccountType, AccountWithBalance } from '@/src/types/finance';
import { formatIsoDate, localDateFromDate } from '@/src/utils/dates';
import { formatVnd } from '@/src/utils/money';

const TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Tiền mặt' },
  { value: 'bank', label: 'Ngân hàng' },
  { value: 'ewallet', label: 'Ví điện tử' },
  { value: 'other', label: 'Khác' },
];

export default function AccountsScreen() {
  const insets = useSafeAreaInsets();
  const revision = useDataStore((state) => state.revision);
  const bump = useDataStore((state) => state.bump);
  const [accounts, setAccounts] = useState<AccountWithBalance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AccountWithBalance | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return listAccounts(getDatabase(), { withBalances: true })
      .then((rows) => setAccounts(rows as AccountWithBalance[]))
      .catch((next) => setError(next instanceof Error ? next.message : 'Không tải được tài khoản.'));
  }, []);

  useFocusEffect(useCallback(() => { void revision; void load(); }, [load, revision]));

  async function save(value: AccountInput) {
    setBusy(true);
    try {
      if (editing) await updateAccount(getDatabase(), editing.id, value);
      else await createAccount(getDatabase(), value);
      setEditing(undefined);
      bump();
      await load();
    } catch (next) {
      Alert.alert('Tài khoản', next instanceof Error ? next.message : 'Không lưu được tài khoản.');
    } finally {
      setBusy(false);
    }
  }

  function archive(account: AccountWithBalance) {
    Alert.alert('Lưu trữ tài khoản?', 'Lịch sử giao dịch và số dư vẫn được giữ nguyên.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Lưu trữ',
        style: 'destructive',
        onPress: () => void setAccountArchived(getDatabase(), account.id, true).then(() => { bump(); return load(); }),
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Tài khoản & ví" />
      {!accounts && !error ? <LoadingState label="Đang tải tài khoản" /> : null}
      {error && !accounts ? <MessageState title="Chưa tải được tài khoản" message={error} actionLabel="Thử lại" onAction={() => void load()} /> : null}
      {accounts ? (
        <ScrollView contentContainerStyle={styles.content}>
          <AppText color={colors.textMuted}>Số dư là ước tính từ số dư đầu kỳ và toàn bộ lịch sử giao dịch.</AppText>
          <View style={styles.list}>
            {accounts.map((account) => (
              <View key={account.id} style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${account.name}, số dư ${formatVnd(account.balance)}`}
                  onPress={() => router.push(`/account/${account.id}` as never)}
                  style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
                >
                  <View style={styles.icon}><AppIcon name="wallet" color={colors.primary} /></View>
                  <View style={styles.copy}>
                    <AppText variant="bodyMedium">{account.name}</AppText>
                    <AppText variant="caption" color={colors.textMuted}>{TYPE_OPTIONS.find((item) => item.value === account.type)?.label}</AppText>
                  </View>
                  <AppText variant="heading">{formatVnd(account.balance)}</AppText>
                  <AppIcon name="chevron-right" color={colors.textMuted} size={18} />
                </Pressable>
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" onPress={() => setEditing(account)} style={styles.smallAction}><AppText variant="caption">Sửa</AppText></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => archive(account)} style={styles.smallAction}><AppText variant="caption" color={colors.expenseText}>Lưu trữ</AppText></Pressable>
                </View>
              </View>
            ))}
          </View>
          <Button label="Thêm tài khoản" onPress={() => setEditing(null)} />
        </ScrollView>
      ) : null}

      <Modal visible={editing !== undefined} transparent animationType="slide" onRequestClose={() => setEditing(undefined)}>
        <View style={styles.backdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Đóng" style={styles.dismiss} onPress={() => setEditing(undefined)} />
          <AccountEditor
            account={editing ?? null}
            busy={busy}
            bottom={insets.bottom}
            onCancel={() => setEditing(undefined)}
            onSave={save}
          />
        </View>
      </Modal>
    </View>
  );
}

function AccountEditor({ account, busy, bottom, onCancel, onSave }: {
  account: AccountWithBalance | null;
  busy: boolean;
  bottom: number;
  onCancel: () => void;
  onSave: (value: AccountInput) => Promise<void>;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'cash');
  const [opening, setOpening] = useState(account ? String(account.openingBalance) : '0');
  const amount = Number(opening.replace(/\D/g, '')) || 0;
  return (
    <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(bottom, 16) + 8 }]}>
      <AppText variant="title">{account ? 'Sửa tài khoản' : 'Tài khoản mới'}</AppText>
      <AppText variant="label" color={colors.textMuted}>Tên tài khoản</AppText>
      <TextInput value={name} onChangeText={setName} placeholder="Ví dụ: TPBank" placeholderTextColor={colors.textMuted} style={styles.input} autoFocus />
      <AppText variant="label" color={colors.textMuted}>Loại</AppText>
      <SegmentedControl value={type} onChange={setType} options={TYPE_OPTIONS} />
      <AppText variant="label" color={colors.textMuted}>Số dư đầu kỳ</AppText>
      <TextInput value={opening} onChangeText={setOpening} keyboardType="number-pad" style={styles.input} accessibilityLabel="Số dư đầu kỳ" />
      <AppText variant="caption" color={colors.textMuted}>Mốc số dư: hôm nay. Thay đổi số dư về sau bằng đối soát để luôn có lịch sử.</AppText>
      <Button
        label="Lưu tài khoản"
        loading={busy}
        disabled={!name.trim()}
        onPress={() => void onSave({ name, type, openingBalance: amount, openingBalanceDate: formatIsoDate(localDateFromDate(new Date())) })}
      />
      <Button label="Hủy" variant="ghost" onPress={onCancel} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 20 },
  list: { borderTopWidth: 1, borderTopColor: colors.divider },
  row: { borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: 10, gap: 4 },
  rowMain: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  smallAction: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  pressed: { opacity: 0.72 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: 12, color: colors.text, fontFamily: 'Inter_400Regular', fontSize: 15, backgroundColor: colors.surface },
});
