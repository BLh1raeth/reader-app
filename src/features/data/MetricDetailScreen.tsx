import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiText } from '../../localization';
import { addLocalCalendarDays, todayLocalDayKey } from '../../shared/time/local-day';
import { formatDuration, weekdayShortName } from './analytics-format';
import { DataCard } from './DataCard';
import { useDataTheme, type DataTheme } from './dataTheme';
import { buildDemoData, USE_DEMO_DATA } from './demo-data';
import {
  getDailyReadingStats,
  getReadingAnalyticsSummary,
  getTodayHourlyActiveSeconds,
} from './reading-analytics-service';
import type { DailyReadingStats, ReadingAnalyticsSummary } from './reading-analytics-types';

export type DataMetric = 'time' | 'speed' | 'rhythm';

type MetricData = {
  summary: ReadingAnalyticsSummary;
  days: DailyReadingStats[];
  hours: number[];
  todayKey: string;
};

const HOURLY_HEIGHT = 154;
const WEEK_HEIGHT = 174;

function dateLabel(dayKey: string): string {
  const [, month, day] = dayKey.split('-').map(Number);
  return `${month}月${day}日`;
}

function HourlyPlot({ hours, theme }: { hours: number[]; theme: DataTheme }) {
  const max = Math.max(...hours, 0);
  return (
    <>
      <View style={[styles.hourlyPlot, { borderBottomColor: theme.divider }]}>
        {hours.map((seconds, hour) => (
          <View key={hour} style={styles.hourColumn}>
            {seconds > 0 ? (
              <View
                style={[
                  styles.hourBar,
                  {
                    height: Math.max(5, Math.round((seconds / max) * HOURLY_HEIGHT)),
                    backgroundColor: theme.chartPrimary,
                  },
                ]}
              />
            ) : (
              <View style={[styles.hourTick, { backgroundColor: theme.chartEmpty }]} />
            )}
          </View>
        ))}
      </View>
      <View style={styles.axisRow}>
        {['00:00', '06:00', '12:00', '18:00'].map((label) => (
          <Text key={label} style={[styles.axisLabel, { color: theme.tertiaryText }]}>{label}</Text>
        ))}
      </View>
    </>
  );
}

function WeekDurationPlot({ days, todayKey, theme }: { days: DailyReadingStats[]; todayKey: string; theme: DataTheme }) {
  const router = useRouter();
  const max = Math.max(...days.map((day) => day.activeSeconds), 0);
  return (
    <View style={styles.weekPlot}>
      {days.map((day) => (
        <Pressable
          key={day.dayKey}
          accessibilityRole="button"
          accessibilityLabel={`${dateLabel(day.dayKey)}，${formatDuration(day.activeSeconds)}`}
          onPress={() => router.push({ pathname: '/data/[dayKey]', params: { dayKey: day.dayKey } })}
          style={styles.weekColumn}
        >
          <View style={styles.weekBarArea}>
            <View
              style={[
                styles.weekBar,
                {
                  height: day.activeSeconds > 0 && max > 0
                    ? Math.max(7, Math.round((day.activeSeconds / max) * WEEK_HEIGHT))
                    : 5,
                  backgroundColor: day.activeSeconds === 0
                    ? theme.chartEmpty
                    : day.dayKey === todayKey ? theme.chartPrimary : theme.trendOther,
                },
              ]}
            />
          </View>
          <Text style={[styles.weekLabel, { color: day.dayKey === todayKey ? theme.primaryText : theme.tertiaryText }]}>
            {weekdayShortName(day.dayKey)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function WeekSpeedPlot({ days, todayKey, theme }: { days: DailyReadingStats[]; todayKey: string; theme: DataTheme }) {
  const router = useRouter();
  const values = days.flatMap((day) => [
    day.readingSpeedP10CharsPerMinute,
    day.readingSpeedP90CharsPerMinute,
    day.readingSpeedLatestCharsPerMinute,
  ]).filter((value): value is number => value !== null);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 100;
  const pad = Math.max(20, (high - low) * 0.15);
  const min = Math.max(0, low - pad);
  const max = high + pad;
  const toY = (value: number) => WEEK_HEIGHT - 8 - ((value - min) / (max - min)) * (WEEK_HEIGHT - 16);
  return (
    <>
      <View style={[styles.speedPlot, { borderBottomColor: theme.divider }]}>
        {[0, 0.5, 1].map((fraction) => (
          <View key={fraction} style={[styles.speedGrid, { top: fraction * WEEK_HEIGHT, backgroundColor: theme.divider }]} />
        ))}
        {days.map((day) => {
          const p10 = day.readingSpeedP10CharsPerMinute;
          const p90 = day.readingSpeedP90CharsPerMinute;
          const latest = day.readingSpeedLatestCharsPerMinute;
          return (
            <Pressable
              key={day.dayKey}
              accessibilityRole="button"
              accessibilityLabel={`${dateLabel(day.dayKey)}，${day.readingSpeedCharsPerMinute === null ? uiText.data.noSpeedData : `${Math.round(day.readingSpeedCharsPerMinute)}${uiText.data.speedUnit}`}`}
              onPress={() => router.push({ pathname: '/data/[dayKey]', params: { dayKey: day.dayKey } })}
              style={styles.speedColumn}
            >
              {p10 !== null && p90 !== null ? (
                <View
                  style={[
                    styles.speedCapsule,
                    {
                      top: toY(p90),
                      height: Math.max(6, toY(p10) - toY(p90)),
                      backgroundColor: day.dayKey === todayKey ? theme.chartSecondary : theme.chartEmpty,
                    },
                  ]}
                />
              ) : null}
              {day.dayKey === todayKey && latest !== null ? (
                <View style={[styles.speedDot, { top: toY(latest) - 5, backgroundColor: theme.chartPrimary }]} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.axisRow}>
        {days.map((day) => (
          <Text key={day.dayKey} style={[styles.speedAxisLabel, { color: day.dayKey === todayKey ? theme.primaryText : theme.tertiaryText }]}>
            {weekdayShortName(day.dayKey)}
          </Text>
        ))}
      </View>
    </>
  );
}

export function MetricDetailScreen({ metric }: { metric: DataMetric }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useDataTheme();
  const [data, setData] = useState<MetricData | null>(() => {
    if (!USE_DEMO_DATA) return null;
    const demo = buildDemoData(todayLocalDayKey());
    return { summary: demo.summary, days: demo.last7Days, hours: demo.hourlyActiveSeconds, todayKey: demo.todayKey };
  });
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (USE_DEMO_DATA) return;
    let active = true;
    const todayKey = todayLocalDayKey();
    void Promise.all([
      getReadingAnalyticsSummary(),
      getDailyReadingStats({ startDay: addLocalCalendarDays(todayKey, -6), endDay: todayKey }),
      metric === 'time' ? getTodayHourlyActiveSeconds() : Promise.resolve(new Array<number>(24).fill(0)),
    ]).then(([summary, days, hours]) => {
      if (active) setData({ summary, days, hours, todayKey });
    }).catch((error) => {
      if (!active) return;
      if (__DEV__) console.warn('[METRIC_DETAIL_LOAD_FAILED]', error);
      setLoadFailed(true);
    });
    return () => { active = false; };
  }, [metric]);

  const title = metric === 'time'
    ? uiText.data.totalReadingTime
    : metric === 'speed' ? uiText.data.readingSpeed : uiText.data.readingRhythm;
  const days = data?.days ?? [];
  const summary = data?.summary;
  const todayKey = data?.todayKey ?? todayLocalDayKey();
  const activeDays = days.filter((day) => day.activeSeconds > 0).length;
  const speedBounds = days.flatMap((day) => [day.readingSpeedP10CharsPerMinute, day.readingSpeedP90CharsPerMinute])
    .filter((value): value is number => value !== null);
  const speedMin = speedBounds.length ? Math.round(Math.min(...speedBounds)) : null;
  const speedMax = speedBounds.length ? Math.round(Math.max(...speedBounds)) : null;
  const latest = summary?.latestSpeedSample;

  return (
    <View style={[styles.screen, { backgroundColor: theme.pageBackground }]}>
      <View style={[styles.nav, { paddingTop: insets.top + 6, backgroundColor: theme.pageBackground }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uiText.data.title}
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: theme.cardBackground }]}
        >
          <SymbolView name="chevron.left" size={18} weight="bold" tintColor={theme.primaryText} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.navTitle, { color: theme.primaryText }]}>{title}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 36 }]}
        showsVerticalScrollIndicator={false}
      >
        {data ? (
          <>
            <Text style={[styles.periodLabel, { color: theme.secondaryText }]}>{uiText.data.last7Days}</Text>
            <Text style={[styles.periodDates, { color: theme.tertiaryText }]}>
              {dateLabel(days[0].dayKey)} — {dateLabel(todayKey)}
            </Text>

            {metric === 'time' ? (
              <>
                <DataCard>
                  <Text style={[styles.cardEyebrow, { color: theme.secondaryText }]}>{uiText.data.hourlyDistribution}</Text>
                  <Text style={[styles.heroValue, { color: theme.primaryText }]}>{formatDuration(summary!.todayActiveSeconds)}</Text>
                  <HourlyPlot hours={data.hours} theme={theme} />
                  <Text style={[styles.cardCaption, { color: theme.tertiaryText }]}>{uiText.data.timeDetailHint}</Text>
                </DataCard>
                <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>{uiText.data.last7DaysTotalLabel}</Text>
                <DataCard>
                  <Text style={[styles.heroValue, { color: theme.primaryText }]}>{formatDuration(summary!.last7DaysActiveSeconds)}</Text>
                  <WeekDurationPlot days={days} todayKey={todayKey} theme={theme} />
                </DataCard>
              </>
            ) : null}

            {metric === 'speed' ? (
              <>
                <DataCard>
                  <Text style={[styles.cardEyebrow, { color: theme.secondaryText }]}>{uiText.data.speedRangeLabel}</Text>
                  <View style={styles.headlineRow}>
                    <Text style={[styles.heroValue, { color: theme.primaryText }]}>
                      {speedMin === null || speedMax === null ? '—' : `${speedMin}–${speedMax}`}
                    </Text>
                    {speedMin !== null ? <Text style={[styles.heroUnit, { color: theme.tertiaryText }]}>{uiText.data.speedUnit}</Text> : null}
                  </View>
                  <WeekSpeedPlot days={days} todayKey={todayKey} theme={theme} />
                  <Text style={[styles.cardCaption, { color: theme.tertiaryText }]}>{uiText.data.speedRangeHint}</Text>
                </DataCard>
                {latest ? (
                  <View style={[styles.latestPill, { backgroundColor: theme.chartPrimary }]}>
                    <Text style={[styles.latestText, { color: theme.cardBackground }]}>{uiText.data.latestReadingSpeed}</Text>
                    <Text style={[styles.latestText, { color: theme.cardBackground }]}>
                      {Math.round(latest.charsPerMinute)} {uiText.data.speedUnit}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}

            {metric === 'rhythm' ? (
              <>
                <DataCard>
                  <Text style={[styles.cardEyebrow, { color: theme.secondaryText }]}>{uiText.data.last7DaysTotalLabel}</Text>
                  <Text style={[styles.heroValue, { color: theme.primaryText }]}>{formatDuration(summary!.last7DaysActiveSeconds)}</Text>
                  <WeekDurationPlot days={days} todayKey={todayKey} theme={theme} />
                  <Text style={[styles.cardCaption, { color: theme.tertiaryText }]}>
                    {uiText.data.activeDays} {activeDays}/7 {uiText.data.dayUnit}
                  </Text>
                </DataCard>
                <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>{uiText.data.readingRhythm}</Text>
                <DataCard>
                  {[
                    { label: uiText.data.currentStreak, value: `${summary!.currentStreakDays}${uiText.data.dayUnit}` },
                    { label: uiText.data.totalReadingDays, value: `${summary!.totalReadingDays}${uiText.data.dayUnit}` },
                    { label: uiText.data.totalExcerptLabel, value: `${summary!.totalExcerptCount}${uiText.data.excerptUnit}` },
                  ].map((item, index) => (
                    <View key={item.label} style={[styles.statRow, index > 0 && { borderTopColor: theme.divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
                      <Text style={[styles.statLabel, { color: theme.secondaryText }]}>{item.label}</Text>
                      <Text style={[styles.statValue, { color: theme.primaryText }]}>{item.value}</Text>
                    </View>
                  ))}
                </DataCard>
              </>
            ) : null}

            <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>{uiText.data.aboutMetric(title)}</Text>
            <DataCard>
              <Text style={[styles.aboutText, { color: theme.secondaryText }]}>
                {metric === 'time' ? uiText.data.aboutReadingTime
                  : metric === 'speed' ? uiText.data.aboutReadingSpeed : uiText.data.aboutReadingRhythm}
              </Text>
            </DataCard>
          </>
        ) : null}
        {loadFailed ? <Text style={[styles.errorText, { color: theme.secondaryText }]}>{uiText.data.loadFailed}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  nav: { paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  navTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  content: { paddingHorizontal: 20 },
  periodLabel: { fontSize: 14, fontWeight: '700', marginTop: 14 },
  periodDates: { fontSize: 12, fontWeight: '600', marginTop: 3, marginBottom: 14, fontVariant: ['tabular-nums'] },
  cardEyebrow: { fontSize: 13, fontWeight: '600' },
  heroValue: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, marginTop: 4, marginBottom: 20, fontVariant: ['tabular-nums'] },
  heroUnit: { fontSize: 14, fontWeight: '600', marginLeft: 7 },
  headlineRow: { flexDirection: 'row', alignItems: 'baseline' },
  cardCaption: { fontSize: 12, fontWeight: '500', lineHeight: 18, marginTop: 16 },
  sectionTitle: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4, marginTop: 20, marginBottom: 12 },
  hourlyPlot: { height: HOURLY_HEIGHT, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  hourColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  hourBar: { width: 6, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  hourTick: { width: 4, height: 3, borderRadius: 2 },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  axisLabel: { fontSize: 10, fontVariant: ['tabular-nums'] },
  weekPlot: { flexDirection: 'row' },
  weekColumn: { flex: 1, alignItems: 'center' },
  weekBarArea: { height: WEEK_HEIGHT, justifyContent: 'flex-end', alignItems: 'center' },
  weekBar: { width: 17, borderRadius: 9 },
  weekLabel: { fontSize: 11, fontWeight: '600', marginTop: 8 },
  speedPlot: { height: WEEK_HEIGHT, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  speedGrid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  speedColumn: { flex: 1, alignItems: 'center', height: WEEK_HEIGHT },
  speedCapsule: { position: 'absolute', width: 9, borderRadius: 5 },
  speedDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  speedAxisLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  latestPill: { marginTop: 16, borderRadius: 24, minHeight: 50, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  latestText: { fontSize: 13, fontWeight: '700' },
  statRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statLabel: { fontSize: 14, fontWeight: '600' },
  statValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  aboutText: { fontSize: 14, lineHeight: 21 },
  errorText: { textAlign: 'center', fontSize: 14, marginTop: 24 },
});
