import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Header } from '@/src/components/ui/Header';
import { AppIcon } from '@/src/components/ui/Icon';
import { MessageState } from '@/src/components/ui/StateView';
import { TransactionRow } from '@/src/components/ui/TransactionRow';
import { getDatabase } from '@/src/database/expo-client';
import { listAccounts } from '@/src/database/repositories/accounts';
import { listCategories } from '@/src/database/repositories/categories';
import { listTransactions } from '@/src/database/repositories/transactions';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Account, Category, TransactionListItem, TransactionSort, TransactionSource, TransactionType } from '@/src/types/finance';
import { addDays, formatDayLabel, formatIsoDate, localDateFromDate, parseIsoDate } from '@/src/utils/dates';

const PAGE = 40;
const QUICK_TYPES: { id: TransactionType | null; label: string }[] = [
  { id: null, label: 'Tất cả' },
  { id: 'expense', label: 'Chi tiêu' },
  { id: 'income', label: 'Thu nhập' },
];
type DatePreset = 'all' | 'month' | '30days';

export default function TransactionsScreen() {
  const revision = useDataStore((state) => state.revision);
  const insets = useSafeAreaInsets();
  const requestId = useRef(0);
  const loadingMoreRef = useRef(false);
  const [items, setItems] = useState<TransactionListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TransactionType | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [source, setSource] = useState<TransactionSource | null>(null);
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sort, setSort] = useState<TransactionSort>('newest');
  const [draftCategoryId, setDraftCategoryId] = useState<string | null>(null);
  const [draftDatePreset, setDraftDatePreset] = useState<DatePreset>('all');
  const [draftAccountId, setDraftAccountId] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<TransactionSource | null>(null);
  const [draftMinAmount, setDraftMinAmount] = useState('');
  const [draftMaxAmount, setDraftMaxAmount] = useState('');
  const [draftSort, setDraftSort] = useState<TransactionSort>('newest');
  const [filterOpen, setFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchText.trim()), 280);
    return () => clearTimeout(timeout);
  }, [searchText]);

  useFocusEffect(
    useCallback(() => {
      void revision;
      let active = true;
      const db = getDatabase();
      Promise.all([listCategories(db), listAccounts(db)])
        .then(([nextCategories, nextAccounts]) => {
          if (active) {
            setCategories(nextCategories);
            setAccounts(nextAccounts);
          }
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [revision]),
  );

  const load = useCallback(async (offset: number, replace: boolean) => {
    if (!replace && loadingMoreRef.current) return;
    const currentRequest = ++requestId.current;
    if (replace) {
      setLoading(true);
      setError(null);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    const range = dateRange(datePreset);
    try {
      const rows = await listTransactions(getDatabase(), {
        search,
        type,
        categoryId,
        accountId,
        source,
        from: range.from,
        to: range.to,
        minAmount: parseAmountFilter(minAmount),
        maxAmount: parseAmountFilter(maxAmount),
        sort,
        limit: PAGE,
        offset,
      });
      if (currentRequest !== requestId.current) return;
      setHasMore(rows.length === PAGE);
      setItems((current) => (replace ? rows : [...current, ...rows]));
    } catch {
      if (currentRequest === requestId.current) setError('Không tải được giao dịch.');
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [accountId, categoryId, datePreset, maxAmount, minAmount, search, sort, source, type]);

  useFocusEffect(
    useCallback(() => {
      void revision;
      void load(0, true);
      return () => {
        requestId.current += 1;
        loadingMoreRef.current = false;
      };
    }, [load, revision]),
  );

  const sections = groupByDate(items);
  const advancedCount = Number(categoryId != null) + Number(datePreset !== 'all') + Number(accountId != null)
    + Number(source != null) + Number(Boolean(minAmount || maxAmount)) + Number(sort !== 'newest');
  const hasQuery = Boolean(search || type || advancedCount > 0);

  function openFilters() {
    setDraftCategoryId(categoryId);
    setDraftDatePreset(datePreset);
    setDraftAccountId(accountId);
    setDraftSource(source);
    setDraftMinAmount(minAmount);
    setDraftMaxAmount(maxAmount);
    setDraftSort(sort);
    setFilterOpen(true);
  }

  function applyFilters() {
    setCategoryId(draftCategoryId);
    setDatePreset(draftDatePreset);
    setAccountId(draftAccountId);
    setSource(draftSource);
    setMinAmount(draftMinAmount);
    setMaxAmount(draftMaxAmount);
    setSort(draftSort);
    setFilterOpen(false);
  }

  function resetAdvanced() {
    setDraftCategoryId(null);
    setDraftDatePreset('all');
    setDraftAccountId(null);
    setDraftSource(null);
    setDraftMinAmount('');
    setDraftMaxAmount('');
    setDraftSort('newest');
  }

  return (
    <View style={styles.screen}>
      <Header title="Giao dịch" />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.content, sections.length === 0 && styles.contentEmpty]}
        stickySectionHeadersEnabled={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          if (hasMore && !loading && !loadingMore) void load(items.length, false);
        }}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View style={styles.search}>
              <AppIcon name="search" color={colors.textMuted} size={18} />
              <TextInput
                accessibilityLabel="Tìm giao dịch"
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Tìm giao dịch..."
                placeholderTextColor={colors.textSecondary}
                returnKeyType="search"
                style={styles.searchInput}
              />
            </View>
            <View style={styles.quickRow}>
              {QUICK_TYPES.map((option) => {
                const selected = type === option.id;
                return (
                  <Pressable
                    key={option.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setType(option.id)}
                    style={({ pressed }) => [styles.quickChip, selected && styles.quickChipSelected, pressed && styles.pressed]}
                  >
                    <AppText variant="caption" color={selected ? colors.surface : colors.text}>{option.label}</AppText>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Bộ lọc${advancedCount ? `, ${advancedCount} đang dùng` : ''}`}
                onPress={openFilters}
                style={({ pressed }) => [styles.filterButton, advancedCount > 0 && styles.filterButtonActive, pressed && styles.pressed]}
              >
                <AppIcon name="filters" color={advancedCount > 0 ? colors.surface : colors.primary} size={19} />
                {advancedCount > 0 ? <AppText variant="label" color={colors.surface}>{advancedCount}</AppText> : null}
              </Pressable>
            </View>
            {error && items.length > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => void load(0, true)} style={styles.inlineError}>
                <AppText variant="caption" color={colors.expenseText}>Không làm mới được danh sách. Chạm để thử lại.</AppText>
              </Pressable>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => <AppText variant="label" color={colors.textMuted} style={styles.section}>{section.title}</AppText>}
        renderItem={({ item }) => <TransactionRow item={item} onPress={(id) => router.push(`/transaction/${id}`)} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loading}><ActivityIndicator accessibilityLabel="Đang tải giao dịch" color={colors.primary} /></View>
          ) : error ? (
            <MessageState title="Chưa tải được giao dịch" message={error} actionLabel="Thử lại" onAction={() => void load(0, true)} />
          ) : hasQuery ? (
            <MessageState title="Không tìm thấy giao dịch" message="Thử đổi từ khóa hoặc đặt lại bộ lọc." actionLabel="Đặt lại" onAction={() => { setSearchText(''); setType(null); setCategoryId(null); setDatePreset('all'); setAccountId(null); setSource(null); setMinAmount(''); setMaxAmount(''); setSort('newest'); }} />
          ) : (
            <MessageState title="Chưa có giao dịch" message="Thêm khoản đầu tiên để bắt đầu theo dõi chi tiêu." actionLabel="Thêm giao dịch" onAction={() => router.push('/transaction/new')} />
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator accessibilityLabel="Đang tải thêm" color={colors.primary} style={styles.footerLoading} /> : null}
      />

      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Đóng bộ lọc" style={styles.modalDismiss} onPress={() => setFilterOpen(false)} />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <AppText variant="title">Bộ lọc</AppText>
              <Pressable accessibilityRole="button" onPress={resetAdvanced} hitSlop={8} style={styles.resetButton}>
                <AppText variant="caption" color={colors.primary}>Đặt lại</AppText>
              </Pressable>
            </View>
            <ScrollView style={styles.filterScroll} contentContainerStyle={styles.filterContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <AppText variant="label" color={colors.textMuted}>Thời gian</AppText>
              <View style={styles.optionGroup}>
              {([
                { id: 'all' as const, label: 'Mọi thời gian' },
                { id: 'month' as const, label: 'Tháng này' },
                { id: '30days' as const, label: '30 ngày gần đây' },
              ]).map((option) => (
                <FilterOption key={option.id} label={option.label} selected={draftDatePreset === option.id} onPress={() => setDraftDatePreset(option.id)} />
              ))}
              </View>
              <AppText variant="label" color={colors.textMuted}>Tài khoản</AppText>
              <View style={styles.optionGroup}>
                <FilterOption label="Mọi tài khoản" selected={draftAccountId == null} onPress={() => setDraftAccountId(null)} />
                {accounts.map((account) => <FilterOption key={account.id} label={account.name} selected={draftAccountId === account.id} onPress={() => setDraftAccountId(account.id)} />)}
              </View>
              <AppText variant="label" color={colors.textMuted}>Hạng mục</AppText>
              <View style={styles.optionGroup}>
                <FilterOption label="Mọi hạng mục" selected={draftCategoryId == null} onPress={() => setDraftCategoryId(null)} />
                {categories.map((category) => (
                  <FilterOption key={category.id} label={category.name} selected={draftCategoryId === category.id} onPress={() => setDraftCategoryId(category.id)} />
                ))}
              </View>
              <AppText variant="label" color={colors.textMuted}>Khoảng tiền</AppText>
              <View style={styles.amountFilters}>
                <TextInput value={draftMinAmount} onChangeText={setDraftMinAmount} keyboardType="number-pad" placeholder="Từ" placeholderTextColor={colors.textMuted} style={styles.amountInput} />
                <TextInput value={draftMaxAmount} onChangeText={setDraftMaxAmount} keyboardType="number-pad" placeholder="Đến" placeholderTextColor={colors.textMuted} style={styles.amountInput} />
              </View>
              <AppText variant="label" color={colors.textMuted}>Nguồn</AppText>
              <View style={styles.optionGroup}>
                <FilterOption label="Mọi nguồn" selected={draftSource == null} onPress={() => setDraftSource(null)} />
                {SOURCE_OPTIONS.map((option) => <FilterOption key={option.id} label={option.label} selected={draftSource === option.id} onPress={() => setDraftSource(option.id)} />)}
              </View>
              <AppText variant="label" color={colors.textMuted}>Sắp xếp</AppText>
              <View style={styles.optionGroup}>
                {SORT_OPTIONS.map((option) => <FilterOption key={option.id} label={option.label} selected={draftSort === option.id} onPress={() => setDraftSort(option.id)} />)}
              </View>
            </ScrollView>
            <Button label="Áp dụng bộ lọc" onPress={applyFilters} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const SOURCE_OPTIONS: { id: TransactionSource; label: string }[] = [
  { id: 'manual', label: 'Nhập tay' }, { id: 'ai', label: 'AI text' }, { id: 'voice', label: 'Giọng nói' },
  { id: 'image', label: 'Ảnh' }, { id: 'bank_notification', label: 'Thông báo ngân hàng' }, { id: 'sheets', label: 'Dữ liệu nhập' },
];
const SORT_OPTIONS: { id: TransactionSort; label: string }[] = [
  { id: 'newest', label: 'Mới nhất' }, { id: 'oldest', label: 'Cũ nhất' },
  { id: 'amount_desc', label: 'Số tiền giảm dần' }, { id: 'amount_asc', label: 'Số tiền tăng dần' },
];

function parseAmountFilter(value: string): number | null {
  const parsed = Number(value.replace(/\D/g, ''));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function FilterOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
      <AppText style={styles.flex}>{label}</AppText>
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  );
}

function dateRange(preset: DatePreset): { from: string | null; to: string | null } {
  const today = localDateFromDate(new Date());
  if (preset === 'month') return { from: formatIsoDate({ ...today, day: 1 }), to: formatIsoDate(today) };
  if (preset === '30days') return { from: formatIsoDate(addDays(today, -29)), to: formatIsoDate(today) };
  return { from: null, to: null };
}

function groupByDate(items: TransactionListItem[]) {
  const today = localDateFromDate(new Date());
  const groups = new Map<string, TransactionListItem[]>();
  for (const item of items) {
    const day = item.occurredAt.slice(0, 10);
    const current = groups.get(day) ?? [];
    current.push(item);
    groups.set(day, current);
  }
  return [...groups.entries()].map(([day, data]) => ({ title: formatDayLabel(parseIsoDate(day), today), data }));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  contentEmpty: { flexGrow: 1 },
  listHeader: { gap: 10, marginBottom: 2 },
  search: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, minHeight: 48, fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.text, paddingVertical: 0 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickChip: { minHeight: 44, flex: 1, paddingHorizontal: 8, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  quickChipSelected: { backgroundColor: colors.primary },
  filterButton: { minWidth: 48, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 10 },
  filterButtonActive: { backgroundColor: colors.primary },
  pressed: { opacity: 0.72 },
  section: { marginTop: 14, marginBottom: 2 },
  loading: { paddingVertical: 32 },
  footerLoading: { paddingVertical: 20 },
  inlineError: { backgroundColor: colors.expenseSoft, borderRadius: radius.md, padding: 10 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalDismiss: { flex: 1 },
  sheet: { maxHeight: '82%', borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.surface, padding: 20, gap: 12 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.divider, alignSelf: 'center' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  resetButton: { minHeight: 44, justifyContent: 'center' },
  optionGroup: { gap: 2 },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  flex: { flex: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.textSecondary, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  filterScroll: { maxHeight: 520 },
  filterContent: { gap: 12, paddingBottom: 8 },
  amountFilters: { flexDirection: 'row', gap: 8 },
  amountInput: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: 12, color: colors.text, fontFamily: 'Inter_400Regular' },
});
