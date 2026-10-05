import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { BarChart, DonutChart, LineChart, SpendingCalendar } from '@/src/components/charts/FinanceCharts';
import { AppText } from '@/src/components/ui/AppText';
import { Header } from '@/src/components/ui/Header';
import { SegmentedControl } from '@/src/components/ui/Pickers';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { LoadingState, MessageState } from '@/src/components/ui/StateView';
import { TransactionRow } from '@/src/components/ui/TransactionRow';
import { getDatabase } from '@/src/database/expo-client';
import { listTransactions } from '@/src/database/repositories/transactions';
import { loadAnalytics, type AnalyticsModel } from '@/src/features/analytics/load-analytics';
import type { CategorySlice } from '@/src/features/analytics/aggregate';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { PeriodKind, TransactionListItem } from '@/src/types/finance';
import { getComparisonRanges, localDateFromDate } from '@/src/utils/dates';
import { formatPercent, formatVnd } from '@/src/utils/money';

type CategoryViewMode = 'chart' | 'list';

export default function AnalyticsScreen() {
  const revision = useDataStore((state) => state.revision);
  const [kind, setKind] = useState<PeriodKind>('month');
  const [model, setModel] = useState<AnalyticsModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedTransactions, setSelectedTransactions] = useState<TransactionListItem[]>([]);
  const [categoryMode, setCategoryMode] = useState<CategoryViewMode>('chart');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoryTransactions, setCategoryTransactions] = useState<TransactionListItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      void revision;
      void reloadToken;
      let active = true;
      setError(null);
      loadAnalytics(getDatabase(), kind)
        .then((next) => {
          if (active) setModel(next);
        })
        .catch(() => {
          if (active) setError('Không tải được thống kê cho kỳ này.');
        });
      return () => {
        active = false;
      };
    }, [kind, revision, reloadToken]),
  );

  const now = new Date();
  const selectedValue = selectedDay == null ? null : model?.series.find((point) => Number(point.label) === selectedDay)?.value ?? 0;

  useEffect(() => {
    if (kind !== 'month' || selectedDay == null) {
      return;
    }
    const selectedMonth = new Date();
    const day = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
    listTransactions(getDatabase(), { type: 'expense', from: day, to: day, limit: 50, offset: 0 })
      .then(setSelectedTransactions)
      .catch(() => setSelectedTransactions([]));
  }, [kind, revision, selectedDay]);

  useEffect(() => {
    if (!selectedCategoryId) {
      return;
    }
    const range = getComparisonRanges(kind, localDateFromDate(new Date())).current;
    listTransactions(getDatabase(), {
      type: 'expense',
      categoryId: selectedCategoryId,
      from: range.start,
      to: range.end,
      limit: 100,
      offset: 0,
    })
      .then(setCategoryTransactions)
      .catch(() => setCategoryTransactions([]));
  }, [kind, revision, selectedCategoryId]);

  return (
    <View style={styles.screen}>
      <Header title="Thống kê" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SegmentedControl
          value={kind}
          onChange={(next) => {
            setKind(next);
            setModel(null);
            setSelectedDay(null);
            setSelectedCategoryId(null);
            setCategoryTransactions([]);
          }}
          options={[
            { value: 'day', label: 'Ngày' },
            { value: 'week', label: 'Tuần' },
            { value: 'month', label: 'Tháng' },
            { value: 'year', label: 'Năm' },
          ]}
        />
        {!model && !error ? <LoadingState label="Đang tải thống kê" /> : null}
        {error && !model ? (
          <MessageState title="Chưa tải được thống kê" message={error} actionLabel="Thử lại" onAction={() => setReloadToken((value) => value + 1)} />
        ) : null}
        {model ? (
          <>
            <View style={styles.summary}>
              <AppText variant="caption" color={colors.textMuted}>{model.label}</AppText>
              <AppText variant="label" color={colors.textMuted}>Tổng chi</AppText>
              <AppText variant="display">{formatVnd(model.expenseTotal)}</AppText>
              <AppText variant="caption" color={colors.textMuted}>{model.changeText}</AppText>
            </View>

            <View style={styles.metrics}>
              <View style={styles.metric} accessible accessibilityLabel={`Trung bình ngày ${formatVnd(model.average)}`}>
                <AppText variant="caption" color={colors.textMuted}>Trung bình ngày</AppText>
                <AppText variant="heading">{formatVnd(model.average)}</AppText>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metric} accessible accessibilityLabel={`Số khoản chi ${model.count}`}>
                <AppText variant="caption" color={colors.textMuted}>Số khoản chi</AppText>
                <AppText variant="heading">{model.count}</AppText>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metric} accessible accessibilityLabel={`Thu nhập ${formatVnd(model.incomeTotal)}`}>
                <AppText variant="caption" color={colors.textMuted}>Thu nhập</AppText>
                <AppText variant="heading" color={colors.incomeText}>{formatVnd(model.incomeTotal)}</AppText>
              </View>
            </View>

            <View style={styles.section}>
              <SectionHeader title="Xu hướng chi tiêu" />
              {model.chart === 'line' ? (
                <LineChart data={model.series} caption={`Xu hướng chi tiêu ${model.label}`} />
              ) : (
                <BarChart data={model.series} caption={`Chi tiêu ${model.label}`} />
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <SectionHeader title="Theo hạng mục" />
                <View style={styles.categoryMode}>
                  <SegmentedControl
                    value={categoryMode}
                    onChange={setCategoryMode}
                    options={[
                      { value: 'chart', label: 'Biểu đồ' },
                      { value: 'list', label: 'Danh sách' },
                    ]}
                  />
                </View>
              </View>
              {categoryMode === 'chart' ? (
                <>
                  <DonutChart slices={model.slices} />
                  <CategoryList
                    slices={model.slices}
                    selectedCategoryId={selectedCategoryId}
                    onSelectCategory={(slice) => setSelectedCategoryId(slice.categoryId)}
                    compact
                  />
                </>
              ) : (
                <CategoryList
                  slices={model.slices}
                  selectedCategoryId={selectedCategoryId}
                  onSelectCategory={(slice) => setSelectedCategoryId(slice.categoryId)}
                />
              )}
              {selectedCategoryId ? (
                <View style={styles.categoryTransactions}>
                  <View style={styles.selectedCategoryHeader}>
                    <AppText variant="bodyMedium">{model.slices.find((slice) => slice.categoryId === selectedCategoryId)?.name ?? 'Hạng mục'}</AppText>
                    <Pressable accessibilityRole="button" onPress={() => setSelectedCategoryId(null)} hitSlop={8}>
                      <AppText variant="caption" color={colors.primary}>Bỏ chọn</AppText>
                    </Pressable>
                  </View>
                  {categoryTransactions.length === 0 ? (
                    <AppText color={colors.textMuted}>Chưa có giao dịch để hiển thị.</AppText>
                  ) : categoryTransactions.map((item) => (
                    <TransactionRow key={item.id} item={item} onPress={(id) => router.push(`/transaction/${id}`)} />
                  ))}
                </View>
              ) : (
                <AppText variant="caption" color={colors.textMuted}>Chạm một hạng mục để xem các khoản chi trong kỳ.</AppText>
              )}
            </View>

            {kind === 'month' ? (
              <View style={styles.section}>
                <SectionHeader title="Lịch chi tiêu" />
                <AppText variant="caption" color={colors.textMuted}>Chọn một ngày để xem tổng chi của ngày đó.</AppText>
                <SpendingCalendar
                  year={now.getFullYear()}
                  month={now.getMonth() + 1}
                  data={model.series}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                />
                {selectedDay != null ? (
                  <>
                    <View style={styles.selectedDay} accessibilityLiveRegion="polite">
                      <AppText variant="caption" color={colors.textMuted}>Ngày {selectedDay}/{now.getMonth() + 1}</AppText>
                      <AppText variant="bodyMedium">{selectedValue ? formatVnd(selectedValue) : 'Không có khoản chi'}</AppText>
                    </View>
                    {selectedTransactions.map((item) => (
                      <TransactionRow key={item.id} item={item} onPress={(id) => router.push(`/transaction/${id}`)} />
                    ))}
                  </>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function CategoryList({
  slices,
  selectedCategoryId,
  onSelectCategory,
  compact = false,
}: {
  slices: CategorySlice[];
  selectedCategoryId: string | null;
  onSelectCategory: (slice: CategorySlice) => void;
  compact?: boolean;
}) {
  if (slices.length === 0) {
    return <AppText color={colors.textMuted}>Chưa có chi tiêu theo hạng mục.</AppText>;
  }
  return (
    <View style={styles.categoryList}>
      {slices.map((slice) => {
        const selected = selectedCategoryId === slice.categoryId;
        return (
          <Pressable
            key={slice.categoryId}
            accessibilityRole="button"
            accessibilityLabel={`${slice.name}, ${formatVnd(slice.total)}, ${formatPercent(slice.share)}`}
            accessibilityState={{ selected }}
            onPress={() => onSelectCategory(slice)}
            style={({ pressed }) => [styles.categoryItem, compact && styles.categoryItemCompact, selected && styles.categoryItemSelected, pressed && styles.pressed]}
          >
            <View style={[styles.categoryMark, { backgroundColor: slice.color }]} />
            <AppText variant="bodyMedium" style={styles.flex} numberOfLines={1}>{slice.name}</AppText>
            <AppText variant="caption" color={colors.textMuted}>{formatPercent(slice.share)}</AppText>
            {!compact ? <AppText variant="bodyMedium" color={colors.expenseText}>{formatVnd(slice.total)}</AppText> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 24 },
  summary: { gap: 5 },
  metrics: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  metric: { flex: 1, gap: 4 },
  metricDivider: { width: 1, backgroundColor: colors.divider },
  section: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 16, gap: 12 },
  sectionTitleRow: { gap: 10 },
  categoryMode: { maxWidth: 240 },
  categoryList: { gap: 4 },
  categoryItem: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, paddingHorizontal: 8 },
  categoryItemCompact: { minHeight: 40 },
  categoryItemSelected: { backgroundColor: colors.surfaceMuted },
  categoryMark: { width: 4, height: 28, borderRadius: 2 },
  flex: { flex: 1 },
  categoryTransactions: { gap: 8, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 12 },
  selectedCategoryHeader: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pressed: { opacity: 0.72 },
  selectedDay: { minHeight: 52, backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
});
