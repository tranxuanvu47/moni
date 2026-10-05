import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { AppIcon } from '@/src/components/ui/Icon';
import { CategoryPicker, SegmentedControl, TRANSACTION_TYPE_OPTIONS } from '@/src/components/ui/Pickers';
import { LoadingState, MessageState } from '@/src/components/ui/StateView';
import { getDatabase } from '@/src/database/expo-client';
import { listAccounts } from '@/src/database/repositories/accounts';
import { listCategories } from '@/src/database/repositories/categories';
import {
  confirmInboxDrafts,
  listInboxDrafts,
  setInboxDraftStatus,
  updateInboxDraft,
} from '@/src/database/repositories/inbox';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Account, Category, TransactionInboxDraft, TransactionType } from '@/src/types/finance';
import { formatTime } from '@/src/utils/dates';
import { formatVnd } from '@/src/utils/money';

const STATUS_LABELS = {
  pending: 'Chờ duyệt',
  needs_review: 'Cần kiểm tra',
  duplicate: 'Có thể trùng',
  rejected: 'Đã bỏ qua',
  confirmed: 'Đã xác nhận',
} as const;

export default function InboxScreen() {
  const revision = useDataStore((state) => state.revision);
  const bump = useDataStore((state) => state.bump);
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<TransactionInboxDraft[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TransactionInboxDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const db = getDatabase();
      const [drafts, categoryRows, accountRows] = await Promise.all([
        listInboxDrafts(db, { statuses: ['pending', 'needs_review', 'duplicate'], limit: 200, offset: 0 }),
        listCategories(db),
        listAccounts(db),
      ]);
      setItems(drafts);
      setCategories(categoryRows);
      setAccounts(accountRows as Account[]);
      setSelected((current) => new Set([...current].filter((id) => drafts.some((item) => item.id === id))));
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Không tải được Hộp chờ.');
    }
  }, []);

  useFocusEffect(useCallback(() => { void revision; void load(); }, [load, revision]));

  const confirmable = useMemo(
    () => (items ?? []).filter((item) => selected.has(item.id) && item.status !== 'duplicate'),
    [items, selected],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function confirmSelected() {
    setBusy(true);
    const result = await confirmInboxDrafts(getDatabase(), confirmable.map((item) => item.id));
    setBusy(false);
    setSelected(new Set());
    bump();
    await load();
    if (result.failed.length) Alert.alert('Hộp chờ', `Đã xác nhận ${result.confirmed.length}. Còn ${result.failed.length} mục cần sửa.`);
  }

  async function reject(id: string) {
    await setInboxDraftStatus(getDatabase(), id, 'rejected');
    bump();
    await load();
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Hộp chờ giao dịch" />
      {!items && !error ? <LoadingState label="Đang tải Hộp chờ" /> : null}
      {error && !items ? <MessageState title="Chưa tải được Hộp chờ" message={error} actionLabel="Thử lại" onAction={() => void load()} /> : null}
      {items ? (
        <ScrollView contentContainerStyle={styles.content}>
          <AppText color={colors.textMuted}>Giao dịch phát hiện tự động chỉ được ghi vào sổ sau khi bạn xác nhận.</AppText>
          {items.length === 0 ? (
            <MessageState title="Hộp chờ trống" message="Thông báo ngân hàng và dữ liệu nhập tự động cần kiểm tra sẽ xuất hiện tại đây." />
          ) : (
            <View style={styles.list}>
              {items.map((item) => {
                const checked = selected.has(item.id);
                return (
                  <View key={item.id} style={styles.item}>
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => toggle(item.id)} style={[styles.check, checked && styles.checkOn]}>
                      {checked ? <AppIcon name="check" color={colors.surface} size={16} /> : null}
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => setEditing(item)} style={styles.itemMain}>
                      <View style={styles.itemTop}>
                        <AppText variant="bodyMedium" numberOfLines={1} style={styles.flex}>{item.description || 'Giao dịch chưa có mô tả'}</AppText>
                        <AppText variant="heading" color={item.proposedType === 'income' ? colors.incomeText : colors.expenseText}>
                          {item.amount ? formatVnd(item.amount) : 'Chưa rõ'}
                        </AppText>
                      </View>
                      <AppText variant="caption" color={colors.textMuted}>{sourceLabel(item)} · {formatTime(item.detectedAt)} · {STATUS_LABELS[item.status]}</AppText>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Bỏ qua giao dịch" onPress={() => void reject(item.id)} style={styles.reject}>
                      <AppIcon name="x" color={colors.expenseText} size={18} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
          {confirmable.length ? <Button label={`Xác nhận ${confirmable.length} giao dịch`} onPress={() => void confirmSelected()} loading={busy} /> : null}
        </ScrollView>
      ) : null}

      <Modal visible={Boolean(editing)} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.dismiss} accessibilityLabel="Đóng" onPress={() => setEditing(null)} />
          {editing ? (
            <DraftEditor
              draft={editing}
              categories={categories}
              accounts={accounts}
              bottom={insets.bottom}
              onCancel={() => setEditing(null)}
              onSave={async (patch) => {
                await updateInboxDraft(getDatabase(), editing.id, patch);
                setEditing(null);
                bump();
                await load();
              }}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

function DraftEditor({ draft, categories, accounts, bottom, onCancel, onSave }: {
  draft: TransactionInboxDraft;
  categories: Category[];
  accounts: Account[];
  bottom: number;
  onCancel: () => void;
  onSave: (patch: { proposedType: TransactionType; amount: number; categoryId: string; accountId: string; description: string; status: 'pending' }) => Promise<void>;
}) {
  const [type, setType] = useState<TransactionType>(draft.proposedType ?? 'expense');
  const [amount, setAmount] = useState(draft.amount ? String(draft.amount) : '');
  const [description, setDescription] = useState(draft.description);
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? categories[0]?.id ?? '');
  const [accountId, setAccountId] = useState(draft.accountId ?? accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const parsed = Number(amount.replace(/\D/g, ''));
  return (
    <ScrollView accessibilityViewIsModal style={styles.sheet} contentContainerStyle={[styles.sheetContent, { paddingBottom: Math.max(bottom, 16) + 8 }]} keyboardShouldPersistTaps="handled">
      <AppText variant="title">Kiểm tra giao dịch</AppText>
      <SegmentedControl value={type} onChange={setType} options={TRANSACTION_TYPE_OPTIONS} />
      <AppText variant="label" color={colors.textMuted}>Số tiền</AppText>
      <TextInput value={amount} onChangeText={setAmount} keyboardType="number-pad" style={styles.input} />
      <AppText variant="label" color={colors.textMuted}>Mô tả</AppText>
      <TextInput value={description} onChangeText={setDescription} style={styles.input} />
      <AppText variant="label" color={colors.textMuted}>Hạng mục</AppText>
      <CategoryPicker categories={categories} type={type} selectedId={categoryId} onSelect={(category) => setCategoryId(category.id)} />
      <AppText variant="label" color={colors.textMuted}>Tài khoản</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {accounts.map((account) => (
          <Pressable key={account.id} accessibilityRole="button" accessibilityState={{ selected: account.id === accountId }} onPress={() => setAccountId(account.id)} style={[styles.accountChip, account.id === accountId && styles.accountChipOn]}>
            <AppText variant="caption" color={account.id === accountId ? colors.surface : colors.text}>{account.name}</AppText>
          </Pressable>
        ))}
      </ScrollView>
      {draft.rawPayload ? <AppText variant="caption" color={colors.textMuted}>{draft.rawPayload}</AppText> : null}
      <Button
        label="Lưu thay đổi"
        loading={busy}
        disabled={!parsed || !categoryId || !accountId}
        onPress={() => { setBusy(true); void onSave({ proposedType: type, amount: parsed, categoryId, accountId, description, status: 'pending' }).finally(() => setBusy(false)); }}
      />
      <Button label="Hủy" variant="ghost" onPress={onCancel} disabled={busy} />
    </ScrollView>
  );
}

function sourceLabel(item: TransactionInboxDraft): string {
  if (item.source === 'bank_notification') return 'Ngân hàng';
  if (item.source === 'voice') return 'Giọng nói';
  if (item.source === 'ai') return 'AI';
  if (item.source === 'imported_statement' || item.source === 'sheets') return 'Sao kê';
  return 'Nhập tay';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 20 },
  list: { borderTopWidth: 1, borderTopColor: colors.divider },
  item: { minHeight: 76, borderBottomWidth: 1, borderBottomColor: colors.divider, flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary },
  itemMain: { flex: 1, gap: 5, paddingVertical: 12 },
  itemTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  flex: { flex: 1 },
  reject: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { maxHeight: '86%', backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetContent: { padding: 20, gap: 12 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: 12, color: colors.text, fontFamily: 'Inter_400Regular', fontSize: 16 },
  chips: { gap: 8 },
  accountChip: { minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.divider, paddingHorizontal: 14 },
  accountChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
