import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarChart } from '@/src/components/charts/FinanceCharts';
import { AmountText, ProgressBar } from '@/src/components/ui/AmountText';
import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Header } from '@/src/components/ui/Header';
import { AppIcon } from '@/src/components/ui/Icon';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { LoadingState, MessageState } from '@/src/components/ui/StateView';
import { TransactionRow } from '@/src/components/ui/TransactionRow';
import { getDatabase } from '@/src/database/expo-client';
import { getPreference, preferenceKeys, setPreference } from '@/src/database/repositories/preferences';
import { insightCacheKey, type InsightPayload } from '@/src/features/analytics/insights';
import { loadDashboard, type DashboardModel } from '@/src/features/dashboard/load-dashboard';
import { describeAiError } from '@/src/services/ai/errors';
import { generateFinancialInsight, getAiRuntimeConfig } from '@/src/services/ai/shopaikey';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import { formatPercent, formatVnd } from '@/src/utils/money';

export default function DashboardScreen() {
  const revision = useDataStore((state) => state.revision);
  const insets = useSafeAreaInsets();
  const [model, setModel] = useState<DashboardModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void revision;
      void reloadToken;
      let active = true;
      setError(null);
      loadDashboard(getDatabase())
        .then((next) => {
          if (active) setModel(next);
        })
        .catch(() => {
          if (active) setError('Không tải được tổng quan. Dữ liệu trên máy vẫn được giữ nguyên.');
        });
      return () => {
        active = false;
      };
    }, [revision, reloadToken]),
  );

  async function openInsight() {
    setDetailsOpen(true);
    if (!model || aiText || aiBusy) return;
    const payload: InsightPayload = {
      periodLabel: model.label,
      expenseTotal: model.expenseTotal,
      incomeTotal: model.incomeTotal,
      previousExpenseTotal: model.previousExpense,
      comparisonNote: model.changeText,
      topCategories: model.categories.map((category) => ({ name: category.name, amount: category.total, share: category.share })),
      budgetAmount: model.budget.amount,
      budgetSpent: model.expenseTotal,
      budgetRemaining: model.budget.amount ? model.budget.remaining : null,
      budgetRatio: model.budget.amount ? model.budget.ratio : null,
      budgetLevel: model.budget.amount ? model.budget.level : null,
      transactionCount: model.transactionCount,
      averageDaily: model.transactionCount > 0 ? Math.round(model.expenseTotal / Math.max(model.highlightIndex + 1, 1)) : 0,
      categoryBudgets: model.budgetJars.map((budget) => ({
        name: budget.name,
        amount: budget.amount,
        spent: budget.amount - budget.remaining,
        remaining: budget.remaining,
        ratio: budget.ratio,
        level: budget.level,
        warningThresholdPercent: budget.warningThresholdPercent,
        limitThresholdPercent: budget.limitThresholdPercent,
      })),
    };
    const key = insightCacheKey(payload);
    const db = getDatabase();
    setAiBusy(true);
    setAiError(null);
    try {
      const [cachedKey, cached] = await Promise.all([
        getPreference(db, preferenceKeys.insightCacheKey),
        getPreference(db, preferenceKeys.insightCache),
      ]);
      if (cached && cachedKey === key) {
        setAiText(cached);
        return;
      }
      const config = await getAiRuntimeConfig();
      if (!config) {
        setAiError('Trợ lý AI chưa được cấu hình trên bản này.');
        return;
      }
      const text = await generateFinancialInsight(payload);
      await Promise.all([
        setPreference(db, preferenceKeys.insightCache, text),
        setPreference(db, preferenceKeys.insightCacheKey, key),
      ]);
      setAiText(text);
    } catch (nextError) {
      setAiError(describeAiError(nextError));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Header title="Tổng quan" />
      {!model && !error ? <LoadingState label="Đang tải tổng quan" /> : null}
      {error && !model ? (
        <MessageState title="Chưa tải được tổng quan" message={error} actionLabel="Thử lại" onAction={() => setReloadToken((value) => value + 1)} />
      ) : null}
      {model ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {error ? (
            <Pressable accessibilityRole="button" onPress={() => setReloadToken((value) => value + 1)} style={styles.inlineError}>
              <AppText variant="caption" color={colors.expenseText}>{error} Chạm để thử lại.</AppText>
            </Pressable>
          ) : null}
          <View style={styles.overview}>
            <AppText variant="caption" color={colors.textMuted}>{model.label}</AppText>
            <AppText variant="label" color={colors.textMuted}>Tổng chi</AppText>
            <AppText variant="display" accessibilityLabel={`Tổng chi ${formatVnd(model.expenseTotal)}`}>{formatVnd(model.expenseTotal)}</AppText>
            <AppText variant="caption" color={colors.textMuted}>{model.changeText}</AppText>
            <View style={styles.cashflow}>
              <View style={styles.cashflowItem}>
                <AppText variant="caption" color={colors.textMuted}>Thu nhập</AppText>
                <AppText variant="bodyMedium" color={colors.incomeText}>{formatVnd(model.incomeTotal)}</AppText>
              </View>
              <View style={styles.cashflowDivider} />
              <View style={styles.cashflowItem}>
                <AppText variant="caption" color={colors.textMuted}>Dòng tiền</AppText>
                <AppText variant="bodyMedium" color={model.incomeTotal - model.expenseTotal >= 0 ? colors.incomeText : colors.expenseText}>
                  {formatVnd(model.incomeTotal - model.expenseTotal)}
                </AppText>
              </View>
            </View>
          </View>
          <View style={styles.sectionBlock}>
            <SectionHeader title="Ngân sách" />
            {model.budget.amount ? (
              <View style={styles.budget}>
                <View style={styles.budgetCopy}>
                  <AppText variant="bodyMedium">Còn {formatVnd(Math.max(model.budget.remaining, 0))}</AppText>
                  <AppText variant="caption" color={colors.textMuted}>{formatVnd(model.expenseTotal)} / {formatVnd(model.budget.amount)}</AppText>
                </View>
                <ProgressBar ratio={model.budget.ratio} />
                <AppText variant="caption" color={colors.textMuted}>Đã dùng {formatPercent(model.budget.ratio)}</AppText>
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Thiết lập ngân sách" onPress={() => router.push('/settings/budget')} style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}>
                <View style={styles.inlineActionCopy}>
                  <AppText variant="bodyMedium">Thiết lập ngân sách</AppText>
                  <AppText variant="caption" color={colors.textMuted}>Theo dõi số tiền còn lại trong tháng.</AppText>
                </View>
                <AppIcon name="chevron-right" color={colors.primary} size={20} />
              </Pressable>
            )}
          </View>
          <View style={styles.sectionBlock}>
            <SectionHeader title="Xu hướng chi tiêu" />
            <BarChart data={model.series} highlightIndex={model.highlightIndex} caption={`Chi tiêu từng ngày trong ${model.label}`} />
          </View>
          <View style={styles.sectionBlock}>
            <SectionHeader title="Chi nhiều nhất" actionLabel="Xem tất cả" onAction={() => router.push('/analytics')} />
            {model.categories.length === 0 ? (
              <AppText color={colors.textMuted}>Chưa có khoản chi trong tháng này.</AppText>
            ) : model.categories.slice(0, 3).map((category) => (
              <View key={category.categoryId} style={styles.categoryRow} accessible accessibilityLabel={`${category.name}, ${formatVnd(category.total)}, ${formatPercent(category.share)}`}>
                <View style={[styles.categoryMark, { backgroundColor: category.color }]} />
                <AppText variant="bodyMedium" style={styles.flex} numberOfLines={1}>{category.name}</AppText>
                <AppText variant="caption" color={colors.textMuted}>{formatPercent(category.share)}</AppText>
                <AmountText amount={category.total} type="expense" />
              </View>
            ))}
          </View>
          <View style={styles.sectionBlock}>
            <SectionHeader title="Giao dịch gần đây" actionLabel="Xem tất cả" onAction={() => router.push('/transactions')} />
            {model.recent.length === 0 ? (
              <MessageState title="Chưa có giao dịch" message="Thêm khoản chi đầu tiên để bắt đầu theo dõi tháng này." actionLabel="Thêm giao dịch" onAction={() => router.push('/transaction/new')} />
            ) : model.recent.slice(0, 4).map((item) => <TransactionRow key={item.id} item={item} onPress={(id) => router.push(`/transaction/${id}`)} />)}
          </View>
          <View style={[styles.sectionBlock, styles.insight]}>
            <AppIcon name="chart-column" color={colors.primary} size={20} />
            <View style={styles.insightCopy}>
              <AppText variant="label" color={colors.textMuted}>Gợi ý tháng này</AppText>
              <AppText>{model.insight}</AppText>
            </View>
            <Button label="Xem phân tích" variant="ghost" onPress={() => void openInsight()} />
          </View>
        </ScrollView>
      ) : null}
      <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Đóng phân tích" style={styles.modalDismiss} onPress={() => setDetailsOpen(false)} />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
            <View style={styles.sheetHandle} />
            <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
              <AppText variant="title">Phân tích chi tiêu</AppText>
              {model ? <AppText>{model.insight}</AppText> : null}
              {aiBusy ? <LoadingState label="Đang tạo phân tích" /> : null}
              {aiText ? <AppText color={colors.textMuted}>{aiText}</AppText> : null}
              {aiError ? <AppText color={colors.expenseText}>{aiError}</AppText> : null}
              <AppText variant="caption" color={colors.textMuted}>Chỉ dữ liệu tổng hợp được gửi để tạo phần giải thích này.</AppText>
              <Button label="Đóng" variant="secondary" onPress={() => setDetailsOpen(false)} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 24 },
  overview: { gap: 5 },
  cashflow: { marginTop: 10, flexDirection: 'row', alignItems: 'stretch', gap: 16 },
  cashflowItem: { flex: 1, gap: 2 },
  cashflowDivider: { width: 1, backgroundColor: colors.divider },
  sectionBlock: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 16, gap: 12 },
  budget: { gap: 8 },
  budgetCopy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  inlineAction: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, paddingVertical: 10 },
  inlineActionCopy: { flex: 1, gap: 2 },
  pressed: { opacity: 0.72 },
  categoryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryMark: { width: 4, height: 28, borderRadius: 2 },
  flex: { flex: 1 },
  insight: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.primarySoft, borderTopWidth: 0, borderRadius: radius.lg, padding: 14 },
  insightCopy: { flex: 1, gap: 4 },
  inlineError: { borderRadius: radius.md, backgroundColor: colors.expenseSoft, padding: 12 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalDismiss: { flex: 1 },
  sheet: { maxHeight: '82%', backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 },
  sheetContent: { gap: 14 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.divider, alignSelf: 'center' },
});
