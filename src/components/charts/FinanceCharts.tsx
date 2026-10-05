import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Rect, Line, Circle, G, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/src/components/ui/AppText';
import { colors } from '@/src/theme/tokens';
import type { ChartPoint, CategorySlice } from '@/src/features/analytics/aggregate';
import { formatCompactVnd, formatPercent, formatVnd } from '@/src/utils/money';

export function BarChart({
  data,
  highlightIndex,
  caption,
}: {
  data: ChartPoint[];
  highlightIndex?: number;
  caption: string;
}) {
  const [width, setWidth] = useState(0);
  const height = 148;
  const max = Math.max(...data.map((item) => item.value), 0);
  const populated = data.filter((item) => item.value > 0);
  if (data.length === 0 || max === 0) {
    return <AppText color={colors.textSecondary}>Chưa có dữ liệu cho biểu đồ.</AppText>;
  }

  if (populated.length === 1 && populated[0]) {
    return (
      <View accessibilityRole="image" accessibilityLabel={`${caption}. ${populated[0].label}: ${formatVnd(populated[0].value)}`} style={styles.sparse}>
        <View style={styles.sparseCopy}>
          <AppText variant="caption" color={colors.textMuted}>Ngày có chi tiêu</AppText>
          <AppText variant="bodyMedium">{populated[0].label}</AppText>
        </View>
        <AppText variant="heading" color={colors.expenseText}>{formatVnd(populated[0].value)}</AppText>
      </View>
    );
  }

  const labelStep = data.length > 16 ? 5 : 1;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={caption}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line x1={0} y1={120} x2={width} y2={120} stroke={colors.divider} strokeWidth={1} />
          {data.map((item, index) => {
            const slot = width / data.length;
            const barWidth = Math.max(slot - 6, 3);
            const barHeight = max === 0 ? 0 : (item.value / max) * 104;
            const x = index * slot + (slot - barWidth) / 2;
            const y = 120 - barHeight;
            const selected = index === highlightIndex;
            return (
              <G key={`${item.label}-${index}`}>
                <Rect x={x} y={y} width={barWidth} height={barHeight} rx={Math.min(6, barWidth / 2)} fill={selected ? colors.primary : colors.primarySoft} />
                {index % labelStep === 0 ? (
                  <SvgText x={x + barWidth / 2} y={140} fontSize={10} fill={colors.textSecondary} textAnchor="middle">
                    {item.label}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </Svg>
      ) : null}
      <AppText variant="caption" color={colors.textMuted}>
        {max === 0 ? 'Chưa có chi tiêu trong kỳ này.' : `Cao nhất ${formatCompactVnd(max)}`}
      </AppText>
    </View>
  );
}

export function LineChart({ data, caption }: { data: ChartPoint[]; caption: string }) {
  const [width, setWidth] = useState(0);
  const height = 148;
  const max = Math.max(...data.map((item) => item.value), 0);
  if (data.length === 0 || max === 0) {
    return <AppText color={colors.textMuted}>Chưa có chi tiêu trong kỳ này.</AppText>;
  }
  return (
    <View accessibilityRole="image" accessibilityLabel={caption} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 && data.length > 0 ? (
        <Svg width={width} height={height}>
          <Line x1={0} y1={112} x2={width} y2={112} stroke={colors.divider} strokeWidth={1} />
          {data.map((item, index) => {
            const x = data.length === 1 ? width / 2 : (index / (data.length - 1)) * (width - 16) + 8;
            const y = max === 0 ? 112 : 112 - (item.value / max) * 96;
            const previous = data[index - 1];
            const previousX = index === 0 || !previous ? x : data.length === 1 ? width / 2 : ((index - 1) / (data.length - 1)) * (width - 16) + 8;
            const previousY = !previous || max === 0 ? 112 : 112 - (previous.value / max) * 96;
            return (
              <G key={`${item.label}-${index}`}>
                {index > 0 ? <Line x1={previousX} y1={previousY} x2={x} y2={y} stroke={colors.primary} strokeWidth={2} /> : null}
                <Circle cx={x} cy={y} r={3} fill={colors.primary} />
                <SvgText x={x} y={136} fontSize={10} fill={colors.textSecondary} textAnchor="middle">
                  {item.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : null}
      <AppText variant="caption" color={colors.textMuted}>
        {max === 0 ? 'Chưa có chi tiêu trong kỳ này.' : `Cao nhất ${formatCompactVnd(max)}`}
      </AppText>
    </View>
  );
}

export function DonutChart({ slices }: { slices: CategorySlice[] }) {
  const [width, setWidth] = useState(0);
  const total = slices.reduce((sum, slice) => sum + slice.total, 0);
  const size = 148;
  const stroke = 16;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = slices.reduce<{ slice: CategorySlice; length: number; offset: number }[]>((current, slice) => {
    const previous = current[current.length - 1];
    const length = total > 0 ? (slice.total / total) * circumference : 0;
    current.push({ slice, length, offset: previous ? previous.offset + previous.length : 0 });
    return current;
  }, []);

  if (total <= 0) {
    return <AppText color={colors.textSecondary}>Chưa có chi tiêu để chia theo hạng mục.</AppText>;
  }

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} accessibilityRole="image" accessibilityLabel="Cơ cấu chi tiêu theo hạng mục">
      <View style={styles.donutRow}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            {segments.map(({ slice, length, offset }) => {
              const dash = `${length} ${circumference - length}`;
              return (
                <Circle
                  key={slice.categoryId}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={slice.color}
                  strokeWidth={stroke}
                  fill="none"
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                />
              );
            })}
          </G>
        </Svg>
        {width > 0 ? (
          <View style={styles.legend}>
            {slices.map((slice) => (
              <View key={slice.categoryId} style={styles.legendRow}>
                <View style={[styles.swatch, { backgroundColor: slice.color }]} />
                <AppText variant="caption" style={styles.legendName} numberOfLines={1}>
                  {slice.name}
                </AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  {formatVnd(slice.total)}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function HorizontalCategoryBars({
  slices,
  limit = 6,
  selectedCategoryId,
  onSelectCategory,
}: {
  slices: CategorySlice[];
  limit?: number;
  selectedCategoryId?: string | null;
  onSelectCategory?: (slice: CategorySlice) => void;
}) {
  const visible = slices.slice(0, limit);
  const max = Math.max(...visible.map((slice) => slice.total), 0);
  if (visible.length === 0 || max <= 0) {
    return <AppText color={colors.textMuted}>Chưa có chi tiêu theo hạng mục.</AppText>;
  }
  return (
    <View style={styles.bars}>
      {visible.map((slice) => {
        const selected = selectedCategoryId === slice.categoryId;
        return (
          <Pressable
            key={slice.categoryId}
            accessibilityRole="button"
            accessibilityLabel={`${slice.name}, ${formatVnd(slice.total)}, ${formatPercent(slice.share)}`}
            accessibilityState={{ selected }}
            disabled={!onSelectCategory}
            onPress={() => onSelectCategory?.(slice)}
            style={({ pressed }) => [styles.barItem, selected && styles.barItemSelected, pressed && styles.pressed]}
          >
            <View style={styles.barCopy}>
              <AppText variant="bodyMedium" numberOfLines={1} style={styles.barName}>{slice.name}</AppText>
              <AppText variant="caption" color={colors.textMuted}>{formatVnd(slice.total)}</AppText>
            </View>
            <View style={styles.barLine}>
              <View style={[styles.barFill, { width: `${Math.max(4, (slice.total / max) * 100)}%`, backgroundColor: slice.color }]} />
            </View>
            <AppText variant="caption" color={colors.textMuted}>{formatPercent(slice.share)}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SpendingCalendar({
  year,
  month,
  data,
  selectedDay,
  onSelectDay,
}: {
  year: number;
  month: number;
  data: ChartPoint[];
  selectedDay: number | null;
  onSelectDay: (day: number) => void;
}) {
  const values = new Map(data.map((point) => [Number(point.label), point.value]));
  const max = Math.max(...data.map((point) => point.value), 0);
  const totalDays = new Date(year, month, 0).getDate();
  const leading = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells = Array.from({ length: leading + totalDays }, (_, index) => (index < leading ? null : index - leading + 1));
  return (
    <View>
      <View style={styles.weekRow} importantForAccessibility="no-hide-descendants">
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((label) => (
          <AppText key={label} variant="label" color={colors.textMuted} align="center" style={styles.dayCell}>{label}</AppText>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {cells.map((day, index) => {
          if (!day) {
            return <View key={`blank-${index}`} style={styles.dayCell} />;
          }
          const value = values.get(day) ?? 0;
          const selected = selectedDay === day;
          const intensity = max > 0 ? value / max : 0;
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={`Ngày ${day}, ${value > 0 ? `chi ${formatVnd(value)}` : 'không có chi tiêu'}`}
              accessibilityState={{ selected }}
              onPress={() => onSelectDay(day)}
              style={({ pressed }) => [
                styles.dayCell,
                styles.dayButton,
                value > 0 && styles.daySpent,
                intensity > 0.66 && styles.daySpentStrong,
                selected && styles.daySelected,
                pressed && styles.dayPressed,
              ]}
            >
              <AppText variant="caption" color={selected ? colors.surface : colors.text}>{day}</AppText>
              {value > 0 ? (
                <AppText style={styles.dayAmount} color={selected ? colors.surface : colors.textMuted} numberOfLines={1}>
                  {formatCompactVnd(value)}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sparse: {
    minHeight: 72,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sparseCopy: { gap: 2 },
  donutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  legend: {
    flex: 1,
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendName: {
    flex: 1,
  },
  bars: { gap: 16 },
  barItem: { gap: 6, borderRadius: 10, paddingVertical: 4 },
  barItemSelected: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 8 },
  barCopy: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  barName: { flex: 1 },
  barLine: { height: 3, backgroundColor: colors.divider, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 3, borderRadius: 2 },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { flexBasis: '14.285%', maxWidth: '14.285%' },
  dayButton: {
    minHeight: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  daySpent: { backgroundColor: colors.primarySoft },
  daySpentStrong: { borderWidth: 1, borderColor: colors.primary },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayPressed: { opacity: 0.72 },
  dayAmount: { fontFamily: 'Inter_500Medium', fontSize: 9, lineHeight: 12 },
  pressed: { opacity: 0.72 },
});
