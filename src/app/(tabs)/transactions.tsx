import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { AddButton, Header } from '@/src/components/ui/Header';
import { AppIcon } from '@/src/components/ui/Icon';
import { TransactionRow } from '@/src/components/ui/TransactionRow';
import { getDatabase } from '@/src/database/expo-client';
import { listCategories } from '@/src/database/repositories/categories';
import { listTransactions } from '@/src/database/repositories/transactions';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Category, TransactionListItem, TransactionType } from '@/src/types/finance';
import { formatDayLabel, localDateFromDate, parseIsoDate } from '@/src/utils/dates';

const PAGE = 40;

export default function TransactionsScreen() {
  const revision = useDataStore((state) => state.revision);
  const [items, setItems] = useState<TransactionListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TransactionType | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      const rows = await listTransactions(getDatabase(), {
        search,
        type,
        categoryId,
        limit: PAGE,
        offset,
      });
      setHasMore(rows.length === PAGE);
      setItems((current) => (replace ? rows : [...current, ...rows]));
      setLoading(false);
    },
    [search, type, categoryId],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      listCategories(getDatabase())
        .then((next) => {
          if (active) {
            setCategories(next);
          }
        })
        .catch(() => undefined);
      load(0, true).catch(() => setLoading(false));
      return () => {
        active = false;
      };
    }, [load, revision]),
  );

  const sections = groupByDate(items);

  return (
    <View style={styles.screen}>
      <Header title="Giao dịch" right={<AddButton />} />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        onEndReached={() => {
          if (hasMore) {
            void load(items.length, false);
          }
        }}
        ListHeaderComponent={
          <View style={styles.filters}>
            <View style={styles.search}>
              <AppIcon name="search" color={colors.textSecondary} size={18} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Tìm ghi chú hoặc hạng mục"
                placeholderTextColor={colors.textSecondary}
                style={styles.searchInput}
              />
            </View>
            <View style={styles.row}>
              {[
                { id: null, label: 'Tất cả' },
                { id: 'expense' as const, label: 'Chi tiêu' },
                { id: 'income' as const, label: 'Thu nhập' },
              ].map((option) => (
                <Pressable key={option.label} onPress={() => setType(option.id)} style={[styles.chip, type === option.id && styles.chipOn]}>
                  <AppText variant="caption" color={type === option.id ? colors.surface : colors.text}>
                    {option.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <Pressable onPress={() => setCategoryId(null)} style={[styles.chip, categoryId === null && styles.chipOn]}>
                <AppText variant="caption" color={categoryId === null ? colors.surface : colors.text}>
                  Mọi hạng mục
                </AppText>
              </Pressable>
              {categories.map((category) => (
                <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.chip, categoryId === category.id && styles.chipOn]}>
                  <AppText variant="caption" color={categoryId === category.id ? colors.surface : colors.text}>
                    {category.name}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <AppText variant="label" color={colors.textSecondary} style={styles.section}>
            {section.title}
          </AppText>
        )}
        renderItem={({ item }) => <TransactionRow item={item} onPress={(id) => router.push(`/transaction/${id}`)} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <AppText color={colors.textSecondary}>Không có giao dịch khớp bộ lọc.</AppText>
          )
        }
      />
    </View>
  );
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
  return [...groups.entries()].map(([day, data]) => ({
    title: formatDayLabel(parseIsoDate(day), today),
    data,
  }));
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  filters: {
    gap: 10,
    marginBottom: 8,
  },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chipOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  section: {
    marginTop: 16,
  },
});
