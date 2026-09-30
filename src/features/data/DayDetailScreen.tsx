import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Circle, G, Svg } from 'react-native-svg';

import { uiText } from '../../localization';
import { addLocalCalendarDays, compareLocalDayKeys, todayLocalDayKey } from '../../shared/time/local-day';
import { DataCard } from './DataCard';
import { useDataTheme } from './dataTheme';
import { formatDuration, weekdayName, weekdayShortName } from './analytics-format';
import { USE_DEMO_DATA, buildDemoDayDetail } from './demo-data';
import { DEFAULT_DAILY_GOALS, goalRepository, type DailyGoals } from './goal-repository';
import {
  getDailyReadingStats,
  getTodayHourlyActiveSeconds,
} from './reading-analytics-service';
import type { DailyReadingStats } from './reading-analytics-types';

type DayDetail = {
  day: DailyReadingStats;
  /** 目标天 24 小时 activeSeconds 分桶（0..23，零填充）。 */
  hourlyActiveSeconds: number[];
};

/** 24 小时柱状图常量（视觉与一级页 ReadingTimeCard 同家族，全宽加高）。 */
const CHART_HEIGHT = 110;
const BAR_WIDTH = 5;
const MIN_VISIBLE_BAR_HEIGHT = 8;
const AXIS_HOURS = [0, 6, 12, 18];
const AXIS_LABEL_WIDTH = 44;

const METRIC_LABEL_WIDTH = 52;
const HERO_RING_SIZE = 232;
const HERO_RING_RADII = [101, 73, 45];
const MINI_RING_SIZE = 40;
const MINI_RING_RADII = [17, 12, 7];

function weekStartKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return addLocalCalendarDays(dayKey, -((weekday + 6) % 7));
}

function fractionsForDay(day: DailyReadingStats, goals: DailyGoals): number[] {
  const fraction = (value: number, target: number) =>
    target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
  return [
    fraction(day.activeSeconds, goals.targetSeconds),
    fraction(day.forwardCharacters, goals.targetChars),
    fraction(day.excerptCount, goals.targetExcerpts),
  ];
}

function ProgressRings({
  size,
  radii,
  strokeWidth,
  fractions,
  colors,
  trackColor,
}: {
  size: number;
  radii: number[];
  strokeWidth: number;
  fractions: number[];
  colors: readonly string[];
  trackColor: string;
}) {
  const center = size / 2;
  return (
    <Svg width={size} height={size}>
      <G rotation={-90} origin={`${center}, ${center}`}>
        {radii.map((radius, index) => {
          const circumference = 2 * Math.PI * radius;
          return (
            <G key={radius}>
              <Circle cx={center} cy={center} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
              {fractions[index] > 0 ? (
                <Circle
                  cx={center}
                  cy={center}
                  r={radius}
                  stroke={colors[index]}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={`${circumference}`}
                  strokeDashoffset={circumference * (1 - fractions[index])}
                  fill="none"
                />
              ) : null}
            </G>
          );
        })}
      </G>
    </Svg>
  );
}

function WeeklySpeedChart({
  days,
  selectedKey,
  todayKey,
  onSelect,
  theme,
}: {
  days: DailyReadingStats[];
  selectedKey: string;
  todayKey: string;
  onSelect: (key: string) => void;
  theme: ReturnType<typeof useDataTheme>;
}) {
  const values = days.flatMap((item) => [
    item.readingSpeedP10CharsPerMinute,
    item.readingSpeedP90CharsPerMinute,
    item.readingSpeedLatestCharsPerMinute,
  ]).filter((value): value is number => value !== null);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 100;
  const padding = Math.max(20, (high - low) * 0.18);
  const min = Math.max(0, low - padding);
  const max = high + padding;
  const chartHeight = 170;
  const toY = (value: number) =>
    chartHeight - 10 - ((value - min) / (max - min)) * (chartHeight - 20);

  return (
    <>
      <View style={[styles.speedWeekChart, { borderBottomColor: theme.divider }]}>
        {[0, 0.5, 1].map((fraction) => (
          <View
            key={fraction}
            style={[styles.speedGridLine, { top: chartHeight * fraction, backgroundColor: theme.divider }]}
          />
        ))}
        {days.map((item) => {
          const p10 = item.readingSpeedP10CharsPerMinute;
          const p90 = item.readingSpeedP90CharsPerMinute;
          const latest = item.readingSpeedLatestCharsPerMinute;
          const selected = item.dayKey === selectedKey;
          return (
            <Pressable
              key={item.dayKey}
              accessibilityRole="button"
              accessibilityLabel={`${formatDayTitle(item.dayKey)}，${item.readingSpeedCharsPerMinute === null ? uiText.data.noSpeedData : `${Math.round(item.readingSpeedCharsPerMinute)}${uiText.data.speedUnit}`}`}
              accessibilityState={{ disabled: compareLocalDayKeys(item.dayKey, todayKey) > 0 }}
              disabled={compareLocalDayKeys(item.dayKey, todayKey) > 0}
              onPress={() => onSelect(item.dayKey)}
              style={styles.speedWeekColumn}
            >
              {p10 !== null && p90 !== null ? (
                <View
                  style={[
                    styles.speedWeekCapsule,
                    {
                      top: toY(p90),
                      height: Math.max(6, toY(p10) - toY(p90)),
                      backgroundColor: selected ? theme.chartSecondary : theme.chartEmpty,
                    },
                  ]}
                />
              ) : null}
              {selected && latest !== null ? (
                <View style={[styles.speedWeekDot, { top: toY(latest) - 5, backgroundColor: theme.chartPrimary }]} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.speedWeekAxis}>
        {days.map((item) => (
          <Text
            key={item.dayKey}
            style={[styles.speedWeekAxisLabel, { color: item.dayKey === selectedKey ? theme.primaryText : theme.tertiaryText }]}
          >
            {weekdayShortName(item.dayKey)}
          </Text>
        ))}
      </View>
    </>
  );
}

/** dayKey（YYYY-MM-DD）→ “9月27日 周六”；解析失败回退原串。 */
function formatDayTitle(dayKey: string): string {
  const parts = dayKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dayKey;
  const weekday = weekdayName(dayKey);
  return `${parts[1]}月${parts[2]}日${weekday ? ` ${weekday}` : ''}`;
}

/**
 * 每日详情页（数据页二级页面）。
 *
 * 一级页风格延续：分组底 #F3F2F8 / 白圆角卡 28 / section 标题 21pt·800 /
 * 大标题 34pt·800 下滑渐隐 / 白色圆角卡 / 黑白灰图表。
 *
 * 日期周览 + 放大三环目标概览 + 24 小时阅读分布 + 本周速度区间。
 * 图表只呈现现有 Reader Analytics 的时长、字数、摘录、速度数据。
 *
 * 数据：getDailyReadingStats 取所在日历周（zero-filled）；24 小时分桶复用
 * getTodayHourlyActiveSeconds——历史日期传当天末尾，避免只统计到中午；
 * 今天传当前时间，保持与首页实时统计口径一致。
 */
export function DayDetailScreen({ dayKey }: { dayKey: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useDataTheme();
  const todayKey = todayLocalDayKey();
  const firstWeekDay = weekStartKey(dayKey);
  const lastWeekDay = addLocalCalendarDays(firstWeekDay, 6);
  const weekKeys = Array.from({ length: 7 }, (_, index) => addLocalCalendarDays(firstWeekDay, index));
  const ringColors = [theme.chartPrimary, theme.chartSecondary, theme.chartLight];

  const [detail, setDetail] = useState<DayDetail | null>(() =>
    USE_DEMO_DATA ? buildDemoDayDetail(dayKey, todayKey) : null,
  );
  const [weekDays, setWeekDays] = useState<DailyReadingStats[]>(() =>
    USE_DEMO_DATA
      ? weekKeys.map((key) => buildDemoDayDetail(key, todayKey).day)
      : [],
  );
  const [goals, setGoals] = useState<DailyGoals>(DEFAULT_DAILY_GOALS);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadVersion = useRef(0);

  useEffect(() => {
    let active = true;
    void goalRepository.getDailyGoals().then((value) => {
      if (active) setGoals(value);
    }).catch(() => {
      // 目标读取失败时使用默认目标，阅读统计仍然可以展示。
    });
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      if (USE_DEMO_DATA) {
        if (version !== loadVersion.current) return;
        setDetail(buildDemoDayDetail(dayKey, todayKey));
        setWeekDays(Array.from({ length: 7 }, (_, index) =>
          buildDemoDayDetail(addLocalCalendarDays(firstWeekDay, index), todayKey).day));
        setLoadFailed(false);
        return;
      }
      const parts = dayKey.split('-').map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`Invalid dayKey: ${dayKey}`);
      }
      const [days, hourly] = await Promise.all([
        getDailyReadingStats({ startDay: firstWeekDay, endDay: lastWeekDay }),
        getTodayHourlyActiveSeconds(
          dayKey === todayKey
            ? new Date()
            : new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999),
        ),
      ]);
      if (version !== loadVersion.current) return;
      setWeekDays(days);
      const selectedDay = days.find((item) => item.dayKey === dayKey);
      if (selectedDay) setDetail({ day: selectedDay, hourlyActiveSeconds: hourly });
      setLoadFailed(false);
    } catch (error) {
      if (version !== loadVersion.current) return;
      if (__DEV__) {
        console.warn('[DAY_DETAIL_LOAD_FAILED]', error);
      }
      setLoadFailed(true);
    }
  }, [dayKey, todayKey, firstWeekDay, lastWeekDay]);

  useEffect(() => {
    setLoadFailed(false);
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  /**
   * 图表入场动画：数据回来（或切换日期）时重播，与一级页同家族。
   * 柱子底部锚定升起；日期切换时重播。
   */
  const barsProgress = useRef(new RNAnimated.Value(0)).current;
  const detailKey = detail?.day.dayKey ?? null;
  useEffect(() => {
    if (detailKey === null) return;
    barsProgress.setValue(0);
    const animation = RNAnimated.timing(barsProgress, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [detailKey, barsProgress]);

  /** 大标题下滑渐隐（与一级页同一行为）：滚动 0→42pt 时透明度 1→0。 */
  const scrollOffset = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollOffset.set(event.contentOffset.y);
  });
  const floatingTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollOffset.get(), [0, 8, 22, 42], [1, 0.82, 0.12, 0], Extrapolation.CLAMP),
  }));

  const goDay = useCallback(
    (key: string) => {
      if (compareLocalDayKeys(key, todayKey) > 0 || key === dayKey) return;
      router.replace({ pathname: '/data/[dayKey]', params: { dayKey: key } });
    },
    [router, dayKey, todayKey],
  );

  const day = detail?.day.dayKey === dayKey ? detail.day : null;
  const buckets = day === null ? new Array<number>(24).fill(0) : detail?.hourlyActiveSeconds ?? new Array<number>(24).fill(0);
  const maxSeconds = Math.max(0, ...buckets);

  const durationText = day === null ? '—' : formatDuration(day.activeSeconds);
  const charsText =
    day === null ? '—' : `${day.forwardCharacters}${uiText.data.characterUnit}`;
  const excerptText =
    day === null ? '—' : `${day.excerptCount}${uiText.data.excerptUnit}`;

  const speed = day?.readingSpeedCharsPerMinute ?? null;
  const speedP10 = day?.readingSpeedP10CharsPerMinute ?? null;
  const speedP90 = day?.readingSpeedP90CharsPerMinute ?? null;
  const hasSpeedRange = speedP10 !== null && speedP90 !== null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.pageBackground }]}>
      {/* 顶部返回行：固定不随滚动。 */}
      <View style={[styles.navRow, { paddingTop: insets.top + 4 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uiText.data.title}
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <SymbolView
            name="chevron.left"
            size={17}
            tintColor={theme.primaryText}
            weight="semibold"
          />
          <Text style={[styles.backLabel, { color: theme.primaryText }]}>
            {uiText.data.title}
          </Text>
        </Pressable>
      </View>

      <Reanimated.ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {/* 浮动大标题占位：40pt 行高 + 16pt 间距，与一级页一致。 */}
        <View style={styles.floatingTitleSpacer} />

        {/* 参考日历周导航：同一周的每日目标进度可直接点击查看。 */}
        <View style={styles.daySwitcher}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText.data.previousWeek}
            hitSlop={8}
            onPress={() => goDay(addLocalCalendarDays(dayKey, -7))}
            style={styles.daySide}
          >
            <Text style={[styles.daySwitchText, { color: theme.secondaryText }]}>
              ‹
            </Text>
          </Pressable>
          <Text style={[styles.weekRange, { color: theme.secondaryText }]}>
            {Number(firstWeekDay.slice(5, 7))}月{Number(firstWeekDay.slice(8))}日 — {Number(lastWeekDay.slice(5, 7))}月{Number(lastWeekDay.slice(8))}日
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText.data.nextWeek}
            disabled={compareLocalDayKeys(addLocalCalendarDays(dayKey, 7), todayKey) > 0}
            hitSlop={8}
            onPress={() => goDay(addLocalCalendarDays(dayKey, 7))}
            style={[styles.daySide, styles.dayRight]}
          >
            <Text
              style={[
                styles.daySwitchText,
                { color: compareLocalDayKeys(addLocalCalendarDays(dayKey, 7), todayKey) > 0 ? theme.faintText : theme.secondaryText },
              ]}
            >
              ›
            </Text>
          </Pressable>
        </View>
        <View style={styles.weekStrip}>
          {weekKeys.map((key) => {
            const stats = weekDays.find((item) => item.dayKey === key);
            const selected = key === dayKey;
            const future = compareLocalDayKeys(key, todayKey) > 0;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${formatDayTitle(key)}，${stats ? formatDuration(stats.activeSeconds) : '—'}`}
                accessibilityState={{ selected, disabled: future }}
                disabled={future}
                onPress={() => goDay(key)}
                style={styles.weekDay}
              >
                <View style={[styles.weekLabelCircle, selected && { backgroundColor: theme.chartPrimary }]}>
                  <Text style={[styles.weekLabel, { color: selected ? theme.cardBackground : theme.secondaryText }]}>
                    {weekdayShortName(key)}
                  </Text>
                </View>
                <View style={{ opacity: future ? 0.35 : 1 }}>
                  <ProgressRings
                    size={MINI_RING_SIZE}
                    radii={MINI_RING_RADII}
                    strokeWidth={4}
                    fractions={stats ? fractionsForDay(stats, goals) : [0, 0, 0]}
                    colors={ringColors}
                    trackColor={theme.ringTrack}
                  />
                </View>
                <Text style={[styles.weekDate, { color: selected ? theme.primaryText : theme.tertiaryText }]}>
                  {Number(key.slice(-2))}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {day === null ? null : (
          <>
            <Text style={[styles.sectionTitle, styles.firstSectionTitle, { color: theme.primaryText }]}>
              {uiText.data.readingOverview}
            </Text>
            <DataCard style={styles.heroCard}>
              <View
                style={styles.heroRing}
                accessible
                accessibilityLabel={`${uiText.data.dailyGoal}：${fractionsForDay(day, goals).filter((fraction) => fraction >= 1).length}/3`}
              >
                <ProgressRings
                  size={HERO_RING_SIZE}
                  radii={HERO_RING_RADII}
                  strokeWidth={23}
                  fractions={fractionsForDay(day, goals)}
                  colors={ringColors}
                  trackColor={theme.ringTrack}
                />
                <View style={styles.heroRingCenter}>
                  <Text style={[styles.heroRingNumber, { color: theme.primaryText }]}>
                    {fractionsForDay(day, goals).filter((fraction) => fraction >= 1).length}/3
                  </Text>
                  <Text style={[styles.heroRingCaption, { color: theme.secondaryText }]}>
                    {uiText.data.dailyGoal}
                  </Text>
                </View>
              </View>
              <View style={[styles.metricDivider, { backgroundColor: theme.divider }]} />
              <View style={styles.metricRow}>
                <Text style={[styles.durationLabel, { color: ringColors[0] }]}>
                  {uiText.data.todayMetricDuration}
                </Text>
                <Text
                  style={[styles.durationValue, { color: ringColors[0] }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {durationText}
                </Text>
                <Text style={[styles.goalValue, { color: theme.tertiaryText }]}>
                  / {formatDuration(goals.targetSeconds)}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={[styles.charsName, { color: ringColors[1] }]}>
                  {uiText.data.todayMetricChars}
                </Text>
                <Text style={[styles.charsValue, { color: ringColors[1] }]}>
                  {charsText}
                </Text>
                <Text style={[styles.goalValue, { color: theme.tertiaryText }]}>
                  / {goals.targetChars.toLocaleString('zh-CN')}{uiText.data.characterUnit}
                </Text>
              </View>
              <View style={[styles.metricRow, styles.lastMetricRow]}>
                <Text style={[styles.excerptName, { color: ringColors[2] }]}>
                  {uiText.data.todayMetricExcerpts}
                </Text>
                <Text style={[styles.excerptValue, { color: ringColors[2] }]}>
                  {excerptText}
                </Text>
                <Text style={[styles.goalValue, { color: theme.tertiaryText }]}>
                  / {goals.targetExcerpts}{uiText.data.excerptUnit}
                </Text>
              </View>
            </DataCard>

            <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>
              {uiText.data.totalReadingTime}
            </Text>
            <DataCard>
              <Text style={[styles.chartEyebrow, { color: theme.secondaryText }]}>
                {uiText.data.hourlyDistribution}
              </Text>
              <Text style={[styles.chartHeadline, { color: theme.primaryText }]}>
                {durationText}
              </Text>
              <View style={styles.chart} accessible={false}>
                {AXIS_HOURS.map((hour) => (
                  <View
                    key={hour}
                    style={[
                      styles.gridLine,
                      {
                        left: `${(hour / 24) * 100}%`,
                        backgroundColor: theme.chartEmpty,
                      },
                    ]}
                  />
                ))}
                <View style={styles.barsRow}>
                  {buckets.map((seconds, hour) => {
                    const hasData = seconds > 0 && maxSeconds > 0;
                    const barHeight = hasData
                      ? Math.max(
                          MIN_VISIBLE_BAR_HEIGHT,
                          Math.round((seconds / maxSeconds) * CHART_HEIGHT),
                        )
                      : 0;
                    return (
                      <View key={hour} style={styles.barColumn}>
                        {hasData ? (
                          <RNAnimated.View
                            style={[
                              styles.barFill,
                              {
                                height: barHeight,
                                backgroundColor: theme.chartPrimary,
                                transform: [
                                  {
                                    translateY: barsProgress.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [barHeight / 2, 0],
                                    }),
                                  },
                                  { scaleY: barsProgress },
                                ],
                              },
                            ]}
                          />
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
              <View style={styles.axisRow} accessible={false}>
                {AXIS_HOURS.map((hour) => (
                  <Text
                    key={hour}
                    style={[
                      styles.axisLabel,
                      {
                        left: `${(hour / 24) * 100}%`,
                        color: theme.secondaryText,
                      },
                    ]}
                  >
                    {hour}时
                  </Text>
                ))}
              </View>
              <Text style={[styles.chartFooter, { color: theme.secondaryText }]}>
                {uiText.data.peakHour} {formatDuration(maxSeconds)}
              </Text>
            </DataCard>

            <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>
              {uiText.data.readingSpeed}
            </Text>
            <DataCard>
              <Text style={[styles.chartEyebrow, { color: theme.secondaryText }]}>
                {uiText.data.weeklySpeedRange}
              </Text>
              <View style={styles.valueRow}>
                <Text style={[styles.value, { color: theme.primaryText }]}>
                  {speed === null ? '—' : `${Math.round(speed)}`}
                </Text>
                {speed !== null ? (
                  <Text style={[styles.unit, { color: theme.tertiaryText }]}>
                    {uiText.data.speedUnit}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.rangeText, { color: theme.secondaryText }]}>
                {hasSpeedRange && speedP10 !== null && speedP90 !== null
                  ? `P10 ${Math.round(speedP10)} — P90 ${Math.round(speedP90)}`
                  : uiText.data.noSpeedData}
              </Text>
              {weekDays.length === 7 && weekDays[0]?.dayKey === firstWeekDay ? (
                <WeeklySpeedChart days={weekDays} selectedKey={dayKey} todayKey={todayKey} onSelect={goDay} theme={theme} />
              ) : null}
              <Text style={[styles.chartFooter, { color: theme.secondaryText }]}>
                {uiText.data.speedRangeHint}
              </Text>
            </DataCard>
          </>
        )}

        {loadFailed ? (
          <Text style={[styles.errorText, { color: theme.secondaryText }]}>
            {uiText.data.loadFailed}
          </Text>
        ) : null}
      </Reanimated.ScrollView>

      {/* 浮动大标题：日期，下滑渐隐，与一级页同一行为。 */}
      <Reanimated.View
        pointerEvents="none"
        style={[styles.floatingTitle, { top: insets.top + 48 }, floatingTitleStyle]}
      >
        <Text
          accessibilityRole="header"
          style={[styles.largeTitle, styles.floatingTitleText, { color: theme.primaryText }]}
        >
          {formatDayTitle(dayKey)}
        </Text>
      </Reanimated.View>
    </View>
  );
}

const SECTION_SPACING = 16;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  /** 顶部返回行：固定高度 44（含安全区），不随滚动。 */
  navRow: {
    paddingBottom: 8,
    paddingLeft: 12,
    zIndex: 1,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingRight: 12,
  },
  backLabel: {
    fontSize: 17,
    marginLeft: 2,
  },
  content: {
    paddingHorizontal: 20,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 40,
    marginBottom: 16,
  },
  floatingTitleSpacer: {
    height: 56,
  },
  floatingTitle: {
    position: 'absolute',
    left: 20,
  },
  floatingTitleText: {
    marginBottom: 0,
  },
  /** 日期切换行：左/中/右三区，与内容同宽。 */
  daySwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  daySide: {
    flex: 1,
  },
  dayRight: {
    alignItems: 'flex-end',
  },
  weekRange: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  weekStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  weekDay: {
    minWidth: 41,
    alignItems: 'center',
    gap: 2,
  },
  weekLabelCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLabel: { fontSize: 11, fontWeight: '700' },
  weekDate: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  daySwitchText: {
    fontSize: 15,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 12,
    marginTop: SECTION_SPACING,
  },
  firstSectionTitle: { marginTop: 8 },
  heroCard: { alignItems: 'center', paddingTop: 25, paddingBottom: 12 },
  heroRing: {
    width: HERO_RING_SIZE,
    height: HERO_RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRingCenter: { position: 'absolute', alignItems: 'center' },
  heroRingNumber: { fontSize: 27, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroRingCaption: { fontSize: 10, fontWeight: '600' },
  metricDivider: { width: '100%', height: StyleSheet.hairlineWidth, marginTop: 22, marginBottom: 16 },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 13,
  },
  lastMetricRow: {
    marginBottom: 0,
  },
  durationLabel: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    width: METRIC_LABEL_WIDTH,
  },
  durationValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  goalValue: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '600' },
  charsName: {
    fontSize: 18,
    fontWeight: '500',
    width: METRIC_LABEL_WIDTH,
  },
  charsValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  excerptName: {
    fontSize: 14,
    fontWeight: '500',
    width: METRIC_LABEL_WIDTH,
  },
  excerptValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  chart: {
    height: CHART_HEIGHT,
  },
  chartEyebrow: { fontSize: 13, fontWeight: '600' },
  chartHeadline: { fontSize: 30, fontWeight: '800', marginTop: 4, marginBottom: 16 },
  chartFooter: { fontSize: 12, fontWeight: '500', marginTop: 15, lineHeight: 18 },
  gridLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  barsRow: {
    flexDirection: 'row',
    height: CHART_HEIGHT,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
  axisRow: {
    height: 16,
    marginTop: 6,
  },
  axisLabel: {
    position: 'absolute',
    fontSize: 11,
    width: AXIS_LABEL_WIDTH,
    textAlign: 'center',
    transform: [{ translateX: -AXIS_LABEL_WIDTH / 2 }],
  },
  speedWeekChart: { height: 170, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  speedGridLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  speedWeekColumn: { flex: 1, height: 170, alignItems: 'center' },
  speedWeekCapsule: { position: 'absolute', width: 9, borderRadius: 5 },
  speedWeekDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  speedWeekAxis: { flexDirection: 'row', marginTop: 6 },
  speedWeekAxisLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 15,
    marginLeft: 6,
    fontWeight: '500',
  },
  rangeText: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
    fontVariant: ['tabular-nums'],
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
  },
});
