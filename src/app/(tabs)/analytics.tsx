import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { BarChart, DonutChart, LineChart } from '@/src/components/charts/FinanceCharts';
import { AppText } from '@/src/components/ui/AppText';
import { Card } from '@/src/components/ui/Card';
import { Header } from '@/src/components/ui/Header';
import { SegmentedControl } from '@/src/components/ui/Pickers';
import { getDatabase } from '@/src/database/expo-client';
import { loadAnalytics, type AnalyticsModel } from '@/src/features/analytics/load-analytics';
import { useDataStore } from '@/src/store/app-store';
import { colors } from '@/src/theme/tokens';
import type { PeriodKind } from '@/src/types/finance';
import { formatVnd } from '@/src/utils/money';

export default function AnalyticsScreen() {
  const revision = useDataStore((state) => state.revision);
  const [kind, setKind] = useState<PeriodKind>('month');
  const [model, setModel] = useState<AnalyticsModel | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadAnalytics(getDatabase(), kind)
        .then((next) => {
          if (active) {
            setModel(next);
          }
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [kind, revision]),
  );

  return (
    <View style={styles.screen}>
      <Header title="Thống kê" />
      <ScrollView contentContainerStyle={styles.content}>
        <SegmentedControl
          value={kind}
          onChange={setKind}
          options={[
            { value: 'day', label: 'Ngày' },
            { value: 'week', label: 'Tuần' },
            { value: 'month', label: 'Tháng' },
            { value: 'year', label: 'Năm' },
          ]}
        />
        {!model ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <AppText variant="caption" color={colors.textSecondary}>
              {model.label}
            </AppText>
            <AppText variant="label" color={colors.textSecondary}>
              Chi tiêu
            </AppText>
            <AppText variant="display">{formatVnd(model.expenseTotal)}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {model.changeText}
            </AppText>
            <AppText variant="caption" color={colors.income}>
              Thu nhập {formatVnd(model.incomeTotal)}
            </AppText>
            <View style={styles.metrics}>
              <Card style={styles.metric}>
                <AppText variant="caption" color={colors.textSecondary}>
                  Trung bình ngày
                </AppText>
                <AppText variant="heading">{formatVnd(model.average)}</AppText>
              </Card>
              <Card style={styles.metric}>
                <AppText variant="caption" color={colors.textSecondary}>
                  Số giao dịch
                </AppText>
                <AppText variant="heading">{model.count}</AppText>
              </Card>
            </View>
            <Card>
              <AppText variant="heading" style={styles.heading}>
                Xu hướng
              </AppText>
              {model.chart === 'line' ? (
                <LineChart data={model.series} caption={`Xu hướng chi tiêu ${model.label}`} />
              ) : (
                <BarChart data={model.series} caption={`Chi tiêu ${model.label}`} />
              )}
            </Card>
            <Card>
              <AppText variant="heading" style={styles.heading}>
                Theo hạng mục
              </AppText>
              {model.slices[0] ? (
                <AppText variant="caption" color={colors.textSecondary} style={styles.heading}>
                  Cao nhất: {model.slices[0].name}
                </AppText>
              ) : null}
              <DonutChart slices={model.slices} />
            </Card>
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
  metrics: {
    flexDirection: 'row',
    gap: 12,
  },
  metric: {
    flex: 1,
    gap: 4,
  },
  heading: {
    marginBottom: 8,
  },
});
