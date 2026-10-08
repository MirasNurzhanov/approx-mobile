import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { AnalyticsChart } from '@/components/swifts/analytics/AnalyticsChart';
import { useSwiftAnalytics } from '@/components/swifts/analytics/useSwiftAnalytics';
import { fonts, type ColorPalette } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { analyticsDate, periodChange, type AnalyticsDays, type AnalyticsMetric } from '@/services/swiftAnalytics';

const METRICS: { key: AnalyticsMetric; label: string }[] = [
  { key: 'views', label: 'Video views' }, { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' }, { key: 'reposts', label: 'Reposts' },
];

function StudioIcon({ color, size = 24 }: { color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    <Rect x={3} y={13} width={4} height={8} rx={1} fill={color} />
    <Rect x={10} y={8} width={4} height={13} rx={1} fill={color} />
    <Rect x={17} y={3} width={4} height={18} rx={1} fill={color} />
  </Svg>;
}

export default function SwiftAnalyticsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ swift_id?: string }>();
  const swiftId = params.swift_id === undefined ? undefined : Number(params.swift_id);
  const [days, setDays] = useState<AnalyticsDays>(28);
  const [metric, setMetric] = useState<AnalyticsMetric>('views');
  const { data, loading, refreshing, error, refresh, retry } = useSwiftAnalytics(days, swiftId);
  const selectedLabel = METRICS.find(item => item.key === metric)?.label ?? 'Activity';
  const previous = data?.previous_period[metric] ?? 0;
  const current = data?.period[metric] ?? 0;

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
        <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
          <Path d="M14 5 7 12l7 7" fill="none" stroke={colors.t1} strokeWidth={2} />
        </Svg>
      </Pressable>
      <Text style={styles.headerTitle}>Creator studio</Text>
      <View style={styles.privateBadge}><Text style={styles.privateText}>Only you</Text></View>
    </View>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.navActive} />}>
      <View style={styles.intro}>
        <View style={styles.studioMark}><StudioIcon color={colors.navActive} size={28} /></View>
        <View style={styles.introText}>
          <Text style={styles.eyebrow}>SWIFTS ANALYTICS</Text>
          <Text accessibilityRole="header" style={styles.title}>{swiftId === undefined ? 'Your creative pulse' : 'Video analytics'}</Text>
          <Text style={styles.subtitle}>See how people connect with your videos.</Text>
        </View>
      </View>

      <View style={styles.ranges}>
        {([7, 28, 90] as const).map(range => <Pressable key={range} testID={`analytics-range-${range}`}
          accessibilityRole="button" accessibilityLabel={`Last ${range} days`}
          accessibilityState={{ selected: days === range }} onPress={() => setDays(range)}
          style={[styles.range, days === range && styles.rangeSelected]}>
          <Text style={[styles.rangeText, days === range && { color: colors.navOnActive }]}>{range} days</Text>
        </Pressable>)}
      </View>

      {loading && <View style={styles.status} accessibilityLabel="Loading analytics">
        <ActivityIndicator color={colors.navActive} /><Text style={styles.subtitle}>Gathering your analytics…</Text>
      </View>}

      {error && <View style={styles.error} accessibilityRole="alert">
        <Text style={styles.body}>{error}</Text>
        {data && <Text style={styles.small}>Showing your last loaded figures.</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Retry analytics" onPress={retry} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>}

      {data && <>
        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Overview</Text>
          <Text style={styles.small}>{analyticsDate(data.start_date)} – {analyticsDate(data.end_date)} · UTC</Text>
        </View>
        <View style={styles.metrics}>
          {METRICS.map(item => {
            const active = metric === item.key;
            const value = data.period[item.key];
            const before = data.previous_period[item.key];
            return <Pressable key={item.key} testID={`analytics-metric-${item.key}`}
              accessibilityRole="button" accessibilityState={{ selected: active }}
              accessibilityLabel={`${item.label}, ${value.toLocaleString()}, ${periodChange(value, before)} versus previous ${days} days. Show chart.`}
              onPress={() => setMetric(item.key)} style={[styles.metric, active && styles.metricSelected]}>
              <Text style={styles.metricLabel}>{item.label}</Text>
              <Text style={styles.metricValue}>{value.toLocaleString()}</Text>
              <Text style={[styles.change, { color: value < before ? colors.t2 : colors.navActive }]}>{periodChange(value, before)} <Text style={styles.changeCaption}>vs previous period</Text></Text>
            </Pressable>;
          })}
        </View>

        {data.totals.videos === 0 && <View style={styles.empty}>
          <StudioIcon color={colors.navActive} size={30} />
          <Text style={styles.sectionTitle}>Your story starts here</Text>
          <Text style={styles.subtitle}>Post your first Swift to start seeing activity here.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/swifts/compose')} style={styles.retry}>
            <Text style={styles.retryText}>Create a Swift</Text>
          </Pressable>
        </View>}

        <View style={styles.panel}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{selectedLabel} over time</Text>
          <Text style={styles.chartValue}>{current.toLocaleString()}</Text>
          <Text style={styles.subtitle}>{periodChange(current, previous)} compared with the previous {days} days</Text>
          {metric === 'views' && <Text style={styles.small}>Unique viewers per Swift · repeat plays excluded</Text>}
          <AnalyticsChart series={data.series} metric={metric} colors={colors} />
          {data.series.every(day => day[metric] === 0) && <Text style={styles.note}>No {selectedLabel.toLowerCase()} recorded in this period yet.</Text>}
          <Text style={styles.note}>Tap the chart to inspect a day. Dates use UTC; the current day may be incomplete.</Text>
        </View>

        <View style={styles.panel}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Lifetime overview</Text>
          <Text style={styles.subtitle}>{swiftId === undefined ? 'Across your currently retained Swifts' : 'For this Swift'}</Text>
          <View style={styles.lifetime}>
            {[{ key: 'videos', label: 'Videos' }, ...METRICS].map(item => <View key={item.key} style={styles.lifetimeItem}>
              <Text style={styles.lifetimeValue}>{data.totals[item.key as keyof typeof data.totals].toLocaleString()}</Text>
              <Text style={styles.small}>{item.label}</Text>
            </View>)}
          </View>
        </View>

        <View style={styles.panel}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Top Swifts</Text>
          <Text style={styles.subtitle}>By video views in the selected period</Text>
          {data.top_swifts.length === 0 ? <Text style={styles.note}>No viewed Swifts in this period yet.</Text>
            : data.top_swifts.map((swift, index) => <Pressable key={swift.id} accessibilityRole="button"
              accessibilityLabel={`Open Swift ${index + 1}: ${swift.caption || 'Untitled Swift'}, ${swift.views} video views`}
              onPress={() => router.push({ pathname: '/swifts/[id]', params: { id: swift.id } })} style={styles.topSwift}>
              <Text style={styles.rank}>{String(index + 1).padStart(2, '0')}</Text>
              {swift.thumbnail_url ? <Image source={{ uri: swift.thumbnail_url }} style={styles.thumbnail} accessible={false} />
                : <View style={[styles.thumbnail, styles.thumbnailFallback]}><StudioIcon color={colors.t2} /></View>}
              <View style={styles.topDescription}>
                <Text style={styles.topCaption} numberOfLines={2}>{swift.caption || 'Untitled Swift'}</Text>
                <Text style={styles.small}>{analyticsDate(swift.created_at)}</Text>
              </View>
              <Text style={styles.topCount}>{swift.views.toLocaleString()}</Text>
            </Pressable>)}
        </View>

        <View style={styles.explanation}>
          <Text style={styles.explanationTitle}>What these numbers mean</Text>
          <Text style={styles.note}>Video views count unique viewers per Swift, not repeat plays. A person viewing two Swifts can count twice.</Text>
          <Text style={styles.note}>{data.definitions.views}</Text>
          <Text style={styles.note}>{data.definitions.engagements}</Text>
          <Text style={styles.note}>Likes, comments and reposts reflect retained activity and can change when activity is removed.</Text>
        </View>
      </>}
    </ScrollView>
  </View>;
}

const makeStyles = (c: ColorPalette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border, gap: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontFamily: fonts.display, fontSize: 19, color: c.t1, fontWeight: '600' },
  privateBadge: { borderRadius: 20, backgroundColor: c.surface2, paddingHorizontal: 12, paddingVertical: 8 },
  privateText: { color: c.t2, fontSize: 11, fontFamily: fonts.body },
  content: { padding: 20, gap: 20, maxWidth: 760, width: '100%', alignSelf: 'center' },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 12 },
  studioMark: { width: 52, height: 52, borderRadius: 16, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
  introText: { flex: 1, gap: 7 },
  eyebrow: { color: c.t2, fontFamily: fonts.body, fontSize: 11, letterSpacing: 1.6, fontWeight: '700' },
  title: { color: c.t1, fontFamily: fonts.display, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  subtitle: { color: c.t2, fontFamily: fonts.body, fontSize: 13, lineHeight: 20 },
  ranges: { flexDirection: 'row', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, padding: 4, borderRadius: 16, gap: 4 },
  range: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  rangeSelected: { backgroundColor: c.navActive },
  rangeText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: c.t2 },
  status: { minHeight: 240, gap: 16, alignItems: 'center', justifyContent: 'center' },
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { color: c.t1, fontFamily: fonts.display, fontSize: 19, fontWeight: '600' },
  small: { color: c.t2, fontFamily: fonts.body, fontSize: 11, lineHeight: 17 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: -6 },
  metric: { flexGrow: 1, flexBasis: '45%', borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, padding: 16, gap: 10 },
  metricSelected: { borderColor: c.navActive, backgroundColor: c.surface2 },
  metricLabel: { color: c.t2, fontSize: 13, fontFamily: fonts.body },
  metricValue: { color: c.t1, fontSize: 29, fontFamily: fonts.display, fontWeight: '700', fontVariant: ['tabular-nums'] },
  change: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  changeCaption: { color: c.t2, fontWeight: '400', fontSize: 11 },
  panel: { backgroundColor: c.surface, padding: 18, borderWidth: 1, borderColor: c.border, borderRadius: 22, gap: 8 },
  chartValue: { color: c.t1, fontFamily: fonts.display, fontSize: 38, fontWeight: '700', marginTop: 8, fontVariant: ['tabular-nums'] },
  note: { color: c.t2, fontFamily: fonts.body, fontSize: 12, lineHeight: 19, marginTop: 6 },
  lifetime: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, paddingTop: 12 },
  lifetimeItem: { minWidth: '25%', flexGrow: 1, gap: 5 },
  lifetimeValue: { color: c.t1, fontFamily: fonts.display, fontSize: 23, fontWeight: '600', fontVariant: ['tabular-nums'] },
  topSwift: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 16, paddingBottom: 6 },
  rank: { color: c.t2, fontFamily: fonts.display, fontSize: 14, width: 22 },
  thumbnail: { width: 42, height: 60, borderRadius: 8 },
  thumbnailFallback: { backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
  topDescription: { flex: 1, gap: 5 },
  topCaption: { color: c.t1, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  topCount: { color: c.t1, fontFamily: fonts.display, fontSize: 17, fontWeight: '600' },
  explanation: { paddingHorizontal: 4, paddingTop: 2 },
  explanationTitle: { color: c.t1, fontFamily: fonts.body, fontSize: 13, fontWeight: '600' },
  body: { color: c.t1, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
  error: { borderRadius: 18, borderColor: c.border, borderWidth: 1, padding: 20, gap: 12, backgroundColor: c.surface },
  retry: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', alignSelf: 'flex-start', borderRadius: 12, backgroundColor: c.navActive },
  retryText: { color: c.navOnActive, fontFamily: fonts.body, fontSize: 13, fontWeight: '600' },
  empty: { padding: 22, gap: 14, backgroundColor: c.surface2, borderRadius: 20 },
});
