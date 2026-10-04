import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Rect, Line, Circle, G, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/src/components/ui/AppText';
import { colors } from '@/src/theme/tokens';
import type { ChartPoint, CategorySlice } from '@/src/features/analytics/aggregate';
import { formatCompactVnd, formatVnd } from '@/src/utils/money';

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
  if (data.length === 0) {
    return <AppText color={colors.textSecondary}>Chưa có dữ liệu cho biểu đồ.</AppText>;
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
      <AppText variant="caption" color={colors.textSecondary}>
        {max === 0 ? 'Chưa có chi tiêu trong kỳ này.' : `Cao nhất ${formatCompactVnd(max)}`}
      </AppText>
    </View>
  );
}

export function LineChart({ data, caption }: { data: ChartPoint[]; caption: string }) {
  const [width, setWidth] = useState(0);
  const height = 148;
  const max = Math.max(...data.map((item) => item.value), 0);
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
      <AppText variant="caption" color={colors.textSecondary}>
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
  let offset = 0;

  if (total <= 0) {
    return <AppText color={colors.textSecondary}>Chưa có chi tiêu để chia theo hạng mục.</AppText>;
  }

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} accessibilityRole="image" accessibilityLabel="Cơ cấu chi tiêu theo hạng mục">
      <View style={styles.donutRow}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            {slices.map((slice) => {
              const length = (slice.total / total) * circumference;
              const dash = `${length} ${circumference - length}`;
              const element = (
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
              offset += length;
              return element;
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

const styles = StyleSheet.create({
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
});
