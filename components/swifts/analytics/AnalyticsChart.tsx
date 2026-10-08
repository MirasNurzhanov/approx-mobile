import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { fonts, type ColorPalette } from '@/constants/theme';
import { analyticsDate, type AnalyticsDay, type AnalyticsMetric } from '@/services/swiftAnalytics';

export function AnalyticsChart({ series, metric, colors }: {
  series: AnalyticsDay[]; metric: AnalyticsMetric; colors: ColorPalette;
}) {
  const [selected, setSelected] = useState(Math.max(0, series.length - 1));
  const [kind, setKind] = useState<'line' | 'bars'>('line');
  const [width, setWidth] = useState(320);
  useEffect(() => setSelected(Math.max(0, series.length - 1)), [series]);
  const index = Math.min(selected, Math.max(0, series.length - 1));
  const day = series[index];
  const peak = Math.max(1, ...series.map(item => item[metric]));
  const plotWidth = Math.max(64, width);
  const x = (i: number) => 16 + (i / Math.max(1, series.length - 1)) * (plotWidth - 32);
  const y = (value: number) => 148 - (value / peak) * 124;
  const path = series.map((item, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(item[metric])}`).join(' ');
  const label = day ? `${analyticsDate(day.date)}, ${day[metric].toLocaleString()} ${metric}, UTC` : 'No activity';
  const move = (amount: number) => setSelected(Math.max(0, Math.min(series.length - 1, index + amount)));
  const styles = makeStyles(colors);

  return <View>
    <View style={styles.chartHeader}>
      <Text style={styles.peak}>{peak === 1 && series.every(item => item[metric] === 0) ? '0' : peak.toLocaleString()} peak</Text>
      <View style={styles.switchRow}>
        {(['line', 'bars'] as const).map(option => <Pressable key={option}
          testID={`chart-${option}`} accessibilityRole="button"
          accessibilityLabel={`${option === 'line' ? 'Line' : 'Bar'} chart`}
          accessibilityState={{ selected: kind === option }} onPress={() => setKind(option)}
          style={[styles.switch, kind === option && { backgroundColor: colors.surface2 }]}>
          <Text style={[styles.small, { color: kind === option ? colors.t1 : colors.t2 }]}>{option === 'line' ? 'Line' : 'Bars'}</Text>
        </Pressable>)}
      </View>
    </View>
    <Pressable testID="analytics-chart" onLayout={event => setWidth(event.nativeEvent.layout.width || 320)}
      accessibilityRole="adjustable" accessibilityLabel={`${metric} chart. ${label}`}
      accessibilityHint="Swipe up or down to inspect another day."
      accessibilityValue={{ min: 1, max: Math.max(1, series.length), now: index + 1, text: label }}
      accessibilityActions={[{ name: 'increment', label: 'Next day' }, { name: 'decrement', label: 'Previous day' }]}
      onAccessibilityAction={event => move(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      onPress={event => setSelected(Math.max(0, Math.min(series.length - 1,
        Math.round((event.nativeEvent.locationX - 16) / (plotWidth - 32) * Math.max(1, series.length - 1)))))}>
      <Svg width="100%" height={176} viewBox={`0 0 ${plotWidth} 168`} accessible={false} pointerEvents="none">
        {[24, 86, 148].map(level => <Line key={level} x1={16} x2={plotWidth - 16} y1={level} y2={level} stroke={colors.border} strokeDasharray="3 5" />)}
        {kind === 'line' ? <Path d={path} stroke={colors.navActive} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
          : series.map((item, i) => <Rect key={item.date} x={x(i) - Math.min(7, plotWidth * 0.35 / series.length)}
            y={y(item[metric])} width={Math.min(14, plotWidth * 0.7 / series.length)} height={148 - y(item[metric])}
            rx={1} fill={i === index ? colors.navActive : colors.tealLine} />)}
        {day && <>
          <Line x1={x(index)} x2={x(index)} y1={16} y2={148} stroke={colors.t2} strokeDasharray="3 4" />
          <Circle cx={x(index)} cy={y(day[metric])} r={4.5} fill={colors.navActive} stroke={colors.surface} strokeWidth={2} />
        </>}
      </Svg>
    </Pressable>
    <View style={styles.chartHeader}>
      <Text style={styles.small}>{series.length ? analyticsDate(series[0].date) : ''}</Text>
      <Text style={styles.small}>{series.length ? analyticsDate(series[series.length - 1].date) : ''}</Text>
    </View>
    <View style={styles.selectedDay}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous day" disabled={index === 0}
        onPress={() => move(-1)} style={[styles.dayButton, index === 0 && styles.disabled]}><Text style={styles.arrow}>‹</Text></Pressable>
      <Text testID="chart-selected-day" accessibilityLiveRegion="polite" style={styles.dayText}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next day" disabled={index >= series.length - 1}
        onPress={() => move(1)} style={[styles.dayButton, index >= series.length - 1 && styles.disabled]}><Text style={styles.arrow}>›</Text></Pressable>
    </View>
  </View>;
}

const makeStyles = (c: ColorPalette) => StyleSheet.create({
  chartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  peak: { color: c.t2, fontSize: 12, fontFamily: fonts.body },
  small: { color: c.t2, fontSize: 12, fontFamily: fonts.body },
  switchRow: { flexDirection: 'row', gap: 3 },
  switch: { minWidth: 48, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  selectedDay: { marginTop: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg, borderRadius: 14 },
  dayButton: { width: 44, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  arrow: { color: c.t1, fontSize: 26 },
  disabled: { opacity: 0.3 },
  dayText: { flex: 1, color: c.t1, fontFamily: fonts.body, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingVertical: 8 },
});
