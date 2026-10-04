import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AccessibilityInfo } from 'react-native';

import { BarChart } from '@/src/components/charts/FinanceCharts';
import { AmountText, ProgressBar } from '@/src/components/ui/AmountText';
import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { AddButton, Header } from '@/src/components/ui/Header';
import { TransactionRow } from '@/src/components/ui/TransactionRow';
import { getDatabase } from '@/src/database/expo-client';
import { getPreference, preferenceKeys, setPreference } from '@/src/database/repositories/preferences';
import { loadDashboard, type DashboardModel } from '@/src/features/dashboard/load-dashboard';
import { insightCacheKey, type InsightPayload } from '@/src/features/analytics/insights';
import { describeAiError } from '@/src/services/ai/errors';
import { generateFinancialInsight, getAiRuntimeConfig } from '@/src/services/ai/shopaikey';
import { useDataStore } from '@/src/store/app-store';
import { colors } from '@/src/theme/tokens';
import { formatPercent, formatVnd } from '@/src/utils/money';

export default function DashboardScreen() {
  const revision = useDataStore((state) => state.revision);
  const [model, setModel] = useState<DashboardModel | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
      loadDashboard(getDatabase())
        .then((next) => {
          if (active) {
            setModel(next);
          }
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [revision]),
  );

  async function explain() {
    if (!model) {
      return;
    }
    const payload: InsightPayload = {
      periodLabel: model.label,
      expenseTotal: model.expenseTotal,
      incomeTotal: model.incomeTotal,
      previousExpenseTotal: model.previousExpense,
      comparisonNote: model.changeText,
      topCategories: model.categories.map((category) => ({ name: category.name, amount: category.total, share: category.share })),
      budgetAmount: model.budget.amount,
      budgetSpent: model.expenseTotal,
      transactionCount: model.transactionCount,
      averageDaily: model.transactionCount > 0 ? Math.round(model.expenseTotal / Math.max(model.highlightIndex + 1, 1)) : 0,
    };
    const key = insightCacheKey(payload);
    const db = getDatabase();
    const cachedKey = await getPreference(db, preferenceKeys.insightCacheKey);
    const cached = await getPreference(db, preferenceKeys.insightCache);
    if (cached && cachedKey === key) {
      setAiText(cached);
      return;
    }
    setAiBusy(true);
    setAiError(null);
    try {
      const config = await getAiRuntimeConfig();
      if (!config) {
        setAiError('Bản build chưa có khóa AI. Điền src/config/ai.local.ts rồi build lại.');
        return;
      }
      const text = await generateFinancialInsight(payload);
      await setPreference(db, preferenceKeys.insightCache, text);
      await setPreference(db, preferenceKeys.insightCacheKey, key);
      setAiText(text);
    } catch (error) {
      setAiError(describeAiError(error));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Header title="Tổng quan" right={<AddButton />} />
      <ScrollView contentContainerStyle={styles.content}>
        {!model ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <AppText variant="caption" color={colors.textSecondary}>
              {model.label}
            </AppText>
            <AppText variant="label" color={colors.textSecondary}>
              Đã chi
            </AppText>
            <AppText variant="display">{formatVnd(model.expenseTotal)}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {model.changeText}
            </AppText>
            {model.incomeTotal > 0 ? (
              <AppText variant="caption" color={colors.income}>
                Thu nhập {formatVnd(model.incomeTotal)}
              </AppText>
            ) : null}

            <Card>
              {model.budget.amount ? (
                <View style={styles.gap}>
                  <AppText variant="bodyMedium">Ngân sách còn {formatVnd(Math.max(model.budget.remaining, 0))}</AppText>
                  <ProgressBar ratio={model.budget.ratio} />
                  <AppText variant="caption" color={colors.textSecondary}>
                    Đã dùng {formatPercent(model.budget.ratio)} của {formatVnd(model.budget.amount)}
                  </AppText>
                </View>
              ) : (
                <Pressable onPress={() => router.push('/settings/budget')}>
                  <AppText variant="bodyMedium">Đặt ngân sách tháng</AppText>
                  <AppText variant="caption" color={colors.textSecondary}>
                    Để thấy phần còn lại ngay trên màn hình này.
                  </AppText>
                </Pressable>
              )}
            </Card>

            <Card>
              <AppText variant="heading" style={styles.section}>
                Chi theo ngày
              </AppText>
              <BarChart data={model.series} highlightIndex={model.highlightIndex} caption={`Chi tiêu từng ngày trong ${model.label}`} />
            </Card>

            <View style={styles.gap}>
              <AppText variant="heading">Hạng mục</AppText>
              {model.categories.length === 0 ? (
                <AppText color={colors.textSecondary}>Chưa có hạng mục nào trong tháng này.</AppText>
              ) : (
                model.categories.map((category) => (
                  <View key={category.categoryId} style={styles.categoryRow}>
                    <AppText style={styles.flex}>{category.name}</AppText>
                    <AppText variant="caption" color={colors.textSecondary}>
                      {formatPercent(category.share)}
                    </AppText>
                    <AmountText amount={category.total} type="expense" />
                  </View>
                ))
              )}
            </View>

            <View style={styles.gap}>
              <AppText variant="heading">Gần đây</AppText>
              {model.recent.length === 0 ? (
                <View style={styles.gap}>
                  <AppText color={colors.textSecondary}>Chưa có giao dịch. Thêm khoản chi đầu tiên để xem tháng này.</AppText>
                  <Button label="Thêm giao dịch" onPress={() => router.push('/transaction/new')} />
                </View>
              ) : (
                model.recent.map((item) => <TransactionRow key={item.id} item={item} onPress={(id) => router.push(`/transaction/${id}`)} />)
              )}
            </View>

            <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
              <Card>
                <AppText variant="label" color={colors.textSecondary}>
                  Từ dữ liệu của bạn
                </AppText>
                <AppText style={styles.section}>{model.insight}</AppText>
                {aiText ? <AppText color={colors.textSecondary}>{aiText}</AppText> : null}
                {aiError ? <AppText color={colors.expense}>{aiError}</AppText> : null}
                <Button label="Giải thích thêm" variant="secondary" onPress={() => void explain()} loading={aiBusy} />
                <AppText variant="caption" color={colors.textSecondary}>
                  Nút này mới gửi số tổng hợp, không gửi từng giao dịch.
                </AppText>
              </Card>
            </Animated.View>
          </>
        )}
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
  gap: {
    gap: 8,
  },
  section: {
    marginBottom: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flex: {
    flex: 1,
  },
});
