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

import { uiText } from '../../localization';
import { addLocalCalendarDays, todayLocalDayKey } from '../../shared/time/local-day';
import { DataCard } from './DataCard';
import { useDataTheme } from './dataTheme';
import { formatDuration, weekdayName } from './analytics-format';
import { USE_DEMO_DATA, buildDemoDayDetail } from './demo-data';
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

/** 速度胶囊常量（视觉与一级页 ReadingSpeedCard 的单柱一致）。 */
const PLOT_HEIGHT = 110;
const PLOT_INSET = 12;
const CAPSULE_WIDTH = 12;
const MIN_CAPSULE_HEIGHT = 6;
const DOT_SIZE = CAPSULE_WIDTH;
const DOT_DROP_DISTANCE = 28;

/** 三行指标配色与一级页今日卡一致：时长 #111111 / 字数 #3A3A3C / 摘录 #6E6E73。 */
const METRIC_COLORS = ['#111111', '#3A3A3C', '#6E6E73'] as const;
const METRIC_LABEL_WIDTH = 52;

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
 * 大标题 34pt·800 下滑渐隐 / 图表动画 900ms·out(cubic)·native driver。
 *
 * 内容 v1（三块）：
 * 1. 当天三数字（时长 / 字数 / 摘录，与一级页同一口径）；
 * 2. 24 小时分布柱状图（全宽版 ReadingTimeCard）；
 * 3. 当天阅读速度：P10–P90 胶囊 + 最新样本黑点 + 大数字。
 * 顶部日期切换：前一天 /（非今天时）今天 / 后一天（到今天禁用）。
 *
 * 数据：getDailyReadingStats 取单天（zero-filled）；24 小时分桶复用
 * getTodayHourlyActiveSeconds——它按传入 now 所在的 local day 分桶，
 * 把 now pin 到目标日中午即可取任意一天，无需新 SQL。
 */
export function DayDetailScreen({ dayKey }: { dayKey: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useDataTheme();
  const todayKey = todayLocalDayKey();
  const isToday = dayKey === todayKey;

  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      if (USE_DEMO_DATA) {
        setDetail(buildDemoDayDetail(dayKey, todayKey));
        setLoadFailed(false);
        return;
      }
      const parts = dayKey.split('-').map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`Invalid dayKey: ${dayKey}`);
      }
      const [days, hourly] = await Promise.all([
        getDailyReadingStats({ startDay: dayKey, endDay: dayKey }),
        getTodayHourlyActiveSeconds(new Date(parts[0], parts[1] - 1, parts[2], 12)),
      ]);
      setDetail({ day: days[0], hourlyActiveSeconds: hourly });
      setLoadFailed(false);
    } catch (error) {
      if (__DEV__) {
        console.warn('[DAY_DETAIL_LOAD_FAILED]');
      }
      setLoadFailed(true);
    }
  }, [dayKey, todayKey]);

  useEffect(() => {
    setDetail(null);
    setLoadFailed(false);
    void load();
  }, [load]);

  /**
   * 图表入场动画：数据回来（或切换日期）时重播，与一级页同家族。
   * 柱子底部锚定升起；胶囊从中心展开、黑点随后落定。
   */
  const barsProgress = useRef(new RNAnimated.Value(0)).current;
  const capsuleProgress = useRef(new RNAnimated.Value(0)).current;
  const detailKey = detail?.day.dayKey ?? null;
  useEffect(() => {
    if (detailKey === null) return;
    barsProgress.setValue(0);
    capsuleProgress.setValue(0);
    const animation = RNAnimated.parallel([
      RNAnimated.timing(barsProgress, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      RNAnimated.timing(capsuleProgress, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => {
      animation.stop();
    };
  }, [detailKey, barsProgress, capsuleProgress]);

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
      router.replace({ pathname: '/data/[dayKey]', params: { dayKey: key } });
    },
    [router],
  );

  const day = detail?.day ?? null;
  const buckets = detail?.hourlyActiveSeconds ?? new Array<number>(24).fill(0);
  const maxSeconds = Math.max(0, ...buckets);

  const durationText = day === null ? '—' : formatDuration(day.activeSeconds);
  const charsText =
    day === null ? '—' : `${day.forwardCharacters}${uiText.data.characterUnit}`;
  const excerptText =
    day === null ? '—' : `${day.excerptCount}${uiText.data.excerptUnit}`;

  const speed = day?.readingSpeedCharsPerMinute ?? null;
  const speedP10 = day?.readingSpeedP10CharsPerMinute ?? null;
  const speedP90 = day?.readingSpeedP90CharsPerMinute ?? null;
  const speedLatest = day?.readingSpeedLatestCharsPerMinute ?? null;
  const hasSpeedRange = speedP10 !== null && speedP90 !== null;

  /** 速度胶囊几何：与一级页单柱算法一致（纵轴域含最新样本点）。 */
  const renderSpeedCapsule = () => {
    if (!hasSpeedRange || speedP10 === null || speedP90 === null) return null;
    const lo = Math.min(speedP10, speedLatest ?? speedP10);
    const hi = Math.max(speedP90, speedLatest ?? speedP90);
    const pad = Math.max((hi - lo) * 0.25, 25);
    const yLo = lo - pad;
    const yHi = hi + pad;
    const toY = (value: number) =>
      PLOT_HEIGHT - PLOT_INSET - ((value - yLo) / (yHi - yLo)) * (PLOT_HEIGHT - PLOT_INSET * 2);
    const rawTop = toY(speedP90);
    const rawHeight = toY(speedP10) - toY(speedP90);
    const barHeight = Math.max(MIN_CAPSULE_HEIGHT, rawHeight);
    const top =
      rawHeight >= MIN_CAPSULE_HEIGHT ? rawTop : toY((speedP10 + speedP90) / 2) - MIN_CAPSULE_HEIGHT / 2;
    const dotY = speedLatest !== null ? toY(speedLatest) : null;
    return (
      <>
        <RNAnimated.View
          style={[
            styles.capsule,
            {
              height: barHeight,
              top,
              backgroundColor: theme.chartEmpty,
              transform: [{ scaleY: capsuleProgress }],
            },
          ]}
        />
        {dotY !== null ? (
          <RNAnimated.View
            style={[
              styles.dot,
              {
                top: dotY - DOT_SIZE / 2,
                backgroundColor: theme.chartPrimary,
                opacity: capsuleProgress.interpolate({
                  inputRange: [0.45, 0.65],
                  outputRange: [0, 1],
                }),
                transform: [
                  {
                    translateY: capsuleProgress.interpolate({
                      inputRange: [0.45, 1],
                      outputRange: [-DOT_DROP_DISTANCE, 0],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}
      </>
    );
  };

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

        {/* 日期切换：前一天 / 今天（仅非今天）/ 后一天（到今天禁用）。 */}
        <View style={styles.daySwitcher}>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => goDay(addLocalCalendarDays(dayKey, -1))}
            style={styles.daySide}
          >
            <Text style={[styles.daySwitchText, { color: theme.secondaryText }]}>
              ‹ {uiText.data.prevDay}
            </Text>
          </Pressable>
          {isToday ? (
            <View style={styles.daySide} />
          ) : (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => goDay(todayKey)}
              style={styles.dayCenter}
            >
              <Text style={[styles.daySwitchText, { color: theme.secondaryText }]}>
                {uiText.data.today}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={isToday}
            hitSlop={8}
            onPress={() => goDay(addLocalCalendarDays(dayKey, 1))}
            style={[styles.daySide, styles.dayRight]}
          >
            <Text
              style={[
                styles.daySwitchText,
                { color: isToday ? theme.faintText : theme.secondaryText },
              ]}
            >
              {uiText.data.nextDay} ›
            </Text>
          </Pressable>
        </View>

        {detail === null ? null : (
          <>
            {/* 当天三数字：配色/字号与一级页今日卡三行一致。 */}
            <DataCard>
              <View style={styles.metricRow}>
                <Text style={[styles.durationLabel, { color: METRIC_COLORS[0] }]}>
                  {uiText.data.todayMetricDuration}
                </Text>
                <Text
                  style={[styles.durationValue, { color: METRIC_COLORS[0] }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {durationText}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={[styles.charsName, { color: METRIC_COLORS[1] }]}>
                  {uiText.data.todayMetricChars}
                </Text>
                <Text style={[styles.charsValue, { color: METRIC_COLORS[1] }]}>
                  {charsText}
                </Text>
              </View>
              <View style={[styles.metricRow, styles.lastMetricRow]}>
                <Text style={[styles.excerptName, { color: METRIC_COLORS[2] }]}>
                  {uiText.data.todayMetricExcerpts}
                </Text>
                <Text style={[styles.excerptValue, { color: METRIC_COLORS[2] }]}>
                  {excerptText}
                </Text>
              </View>
            </DataCard>

            <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>
              {uiText.data.totalReadingTime}
            </Text>
            <DataCard>
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
            </DataCard>

            <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>
              {uiText.data.readingSpeed}
            </Text>
            <DataCard>
              <View style={styles.speedRow}>
                <View style={styles.capsulePlot} accessible={false}>
                  {renderSpeedCapsule()}
                </View>
                <View style={styles.speedTextCol}>
                  <View style={styles.valueRow}>
                    <Text
                      style={[styles.value, { color: theme.primaryText }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.5}
                    >
                      {speed === null ? '—' : `${Math.round(speed)}`}
                    </Text>
                    {speed !== null ? (
                      <Text style={[styles.unit, { color: theme.tertiaryText }]}>
                        {uiText.data.speedUnit}
                      </Text>
                    ) : null}
                  </View>
                  {hasSpeedRange && speedP10 !== null && speedP90 !== null ? (
                    <Text style={[styles.rangeText, { color: theme.tertiaryText }]}>
                      P10 {Math.round(speedP10)} · P90 {Math.round(speedP90)}
                    </Text>
                  ) : null}
                </View>
              </View>
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

const SECTION_SPACING = 12;

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
    marginBottom: SECTION_SPACING,
  },
  daySide: {
    flex: 1,
  },
  dayCenter: {
    flex: 1,
    alignItems: 'center',
  },
  dayRight: {
    alignItems: 'flex-end',
  },
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
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
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
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    flex: 1,
  },
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
  speedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  capsulePlot: {
    width: 48,
    height: PLOT_HEIGHT,
    alignItems: 'center',
  },
  capsule: {
    position: 'absolute',
    width: CAPSULE_WIDTH,
    borderRadius: CAPSULE_WIDTH / 2,
  },
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  speedTextCol: {
    flex: 1,
    paddingLeft: 12,
  },
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
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
  },
});
