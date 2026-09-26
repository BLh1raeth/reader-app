import { StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';
import { formatDuration, weekdayName, weekdayShortName } from '../analytics-format';

type RhythmCardProps = {
  /** 最近 7 个 local calendar day（含今天），最旧 → 今天；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** 今天的 local day key：趋势图最右侧柱子高亮用。 */
  todayKey: string;
  /** summary.last7DaysActiveSeconds（今天 + 前 6 天）；null = 未加载。 */
  last7DaysActiveSeconds: number | null;
  /** summary.currentStreakDays；null = 未加载。 */
  streakDays: number | null;
  /** summary.totalReadingDays；null = 未加载。 */
  totalDays: number | null;
  /** summary.totalExcerptCount；null = 未加载。 */
  excerptCount: number | null;
};

/** 7 日趋势图绘图区高度。 */
const TREND_CHART_HEIGHT = 110;
/** 圆润胶囊柱宽（16–20pt 建议值内）。 */
const TREND_BAR_WIDTH = 18;
/** 零阅读日的极浅短柱高度（图形空状态，不是 0 秒伪装成阅读）。 */
const TREND_EMPTY_BAR_HEIGHT = 6;
/** 真实非零时长的最低可见柱高，避免数秒阅读完全不可见。 */
const TREND_MIN_VISIBLE_BAR_HEIGHT = 8;

/**
 * 阅读节奏卡（B.7 黑白极简，页面底部大总结卡）。
 *
 * 顶部：书本图标（#636366）+ “阅读节奏”标题（#111111），
 * 右上“全部显示”（#636366，纯装饰）；
 * 结论“最近 7 天，你有 X 天进行了阅读。”（X = 7 天内 activeSeconds > 0 的天数；
 * 7 天全无阅读时只陈述“最近 7 天还没有阅读记录。”，不加评价）；
 * “最近 7 天累计阅读” + formatDuration(summary.last7DaysActiveSeconds)；
 * 7 日阅读时长趋势柱状图（最旧在左、今天在右，圆润胶囊柱）；
 * 轻量分割线；
 * 三列摘要：连续阅读 / 阅读天数 / 累计摘录，列之间很淡的竖分隔线。
 *
 * 所有数字来自 Analytics 实时数据，不写死。
 * 只消费 Analytics 已有输出，不重算口径、不碰统计逻辑。
 */
export function AccumulationCard({
  days,
  todayKey,
  last7DaysActiveSeconds,
  streakDays,
  totalDays,
  excerptCount,
}: RhythmCardProps) {
  const theme = useDataTheme();
  const list = days ?? [];
  const activeDays7 = list.filter((d) => d.activeSeconds > 0).length;

  const streakText = streakDays === null ? '—' : `${streakDays}${uiText.data.dayUnit}`;
  const daysText = totalDays === null ? '—' : `${totalDays}${uiText.data.dayUnit}`;
  const excerptText = excerptCount === null ? '—' : `${excerptCount}${uiText.data.excerptUnit}`;

  const statement =
    days === null
      ? '—'
      : activeDays7 === 0
        ? uiText.data.rhythmSummaryEmpty
        : uiText.data.rhythmSummaryRecent(activeDays7);

  const total7Text =
    last7DaysActiveSeconds === null ? '—' : formatDuration(last7DaysActiveSeconds);

  const maxSeconds = Math.max(0, ...list.map((d) => d.activeSeconds));
  const trendAccessibility =
    days === null
      ? ''
      : `最近 7 天累计阅读${total7Text}。` +
        list
          .map((d) => `${weekdayName(d.dayKey)}阅读${formatDuration(d.activeSeconds)}`)
          .join('，') +
        '。';

  const columns = [
    {
      label: uiText.data.currentStreak,
      value: streakText,
      hint: uiText.data.currentHint,
    },
    {
      label: uiText.data.totalReadingDays,
      value: daysText,
      hint: uiText.data.totalHint,
    },
    {
      label: uiText.data.totalExcerptLabel,
      value: excerptText,
      hint: uiText.data.totalHint,
    },
  ];

  return (
    <DataCard
      accessible
      accessibilityLabel={`${uiText.data.readingRhythm}：${statement}` +
        `${uiText.data.currentStreak}${streakText}，${uiText.data.totalReadingDays}${daysText}，${uiText.data.totalExcerptLabel}${excerptText}`}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleLeft}>
          <SymbolView name="book" size={22} tintColor={theme.secondaryText} weight="medium" />
          <Text style={[styles.title, { color: theme.primaryText }]}>{uiText.data.readingRhythm}</Text>
        </View>
        <Text style={[styles.showAll, { color: theme.secondaryText }]}>{uiText.data.showAll}</Text>
      </View>

      <Text style={[styles.statement, { color: theme.chartPrimary }]}>{statement}</Text>

      <View style={styles.totalBlock}>
        <Text style={[styles.totalLabel, { color: theme.tertiaryText }]}>
          {uiText.data.last7DaysTotalLabel}
        </Text>
        <Text style={[styles.totalValue, { color: theme.primaryText }]}>{total7Text}</Text>
      </View>

      {days !== null ? (
        <View style={styles.trendBlock} accessible accessibilityLabel={trendAccessibility}>
          <View style={styles.trendRow}>
            {list.map((day) => {
              const isToday = day.dayKey === todayKey;
              const hasData = day.activeSeconds > 0 && maxSeconds > 0;
              const barHeight = hasData
                ? Math.max(
                    TREND_MIN_VISIBLE_BAR_HEIGHT,
                    Math.round((day.activeSeconds / maxSeconds) * TREND_CHART_HEIGHT),
                  )
                : TREND_EMPTY_BAR_HEIGHT;
              const barColor = isToday
                ? theme.chartPrimary
                : hasData
                  ? theme.trendOther
                  : theme.trendZero;
              return (
                <View key={day.dayKey} style={styles.trendCol}>
                  <View style={styles.trendPlot}>
                    <View
                      style={[
                        styles.trendBar,
                        { height: barHeight, backgroundColor: barColor },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.trendLabel,
                      isToday ? styles.trendLabelToday : null,
                      { color: isToday ? theme.chartPrimary : theme.tertiaryText },
                    ]}
                  >
                    {weekdayShortName(day.dayKey)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={[styles.divider, { backgroundColor: theme.divider }]} />

      <View style={styles.statsRow}>
        {columns.map((col, i) => (
          <View key={col.label} style={styles.statCol}>
            {i > 0 ? (
              <View style={[styles.vDivider, { backgroundColor: theme.divider }]} />
            ) : null}
            <View style={styles.statBody}>
              <Text style={[styles.statLabel, { color: theme.tertiaryText }]}>
                {col.label}
              </Text>
              <Text
                style={[styles.statValue, { color: theme.primaryText }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {col.value}
              </Text>
              <Text style={[styles.statHint, { color: theme.tertiaryText }]}>{col.hint}</Text>
            </View>
          </View>
        ))}
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** B.7：卡片标题 18pt / 600（整页统一，比之前 700 轻）。 */
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  /** 纯装饰（详情页未实现，不可点）。 */
  showAll: {
    fontSize: 17,
    fontWeight: '700',
  },
  /** B.7：结论句 16pt / 600 / #242424，不再用 17pt / 700 纯黑。 */
  statement: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.4,
    lineHeight: 24,
  },
  totalBlock: {
    marginTop: 16,
  },
  /** B.7：辅助标签 14pt / 500 / #8E8E93。 */
  totalLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  /** B.7：7 日累计时长是卡内视觉重心：28pt / 800 / #111111。 */
  totalValue: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  trendBlock: {
    marginTop: 16,
  },
  trendRow: {
    flexDirection: 'row',
  },
  /** 每列等宽：柱子与星期标签严格对齐。 */
  trendCol: {
    flex: 1,
    alignItems: 'center',
  },
  trendPlot: {
    height: TREND_CHART_HEIGHT,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  /** 圆润胶囊柱：borderRadius = 宽度 / 2，无尖锐直角。 */
  trendBar: {
    width: TREND_BAR_WIDTH,
    borderRadius: TREND_BAR_WIDTH / 2,
  },
  /** B.7：日期标签 12pt；今天 #242424，其余 #8E8E93。 */
  trendLabel: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 8,
  },
  trendLabelToday: {
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },
  statsRow: {
    flexDirection: 'row',
  },
  statCol: {
    flex: 1,
    flexDirection: 'row',
  },
  /** 列之间很淡的竖分隔线（第一列左侧不画）。 */
  vDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginRight: 12,
  },
  statBody: {
    flex: 1,
    alignItems: 'center',
  },
  /** B.7：累计指标标题 14pt / 500。 */
  statLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  /** B.7：累计指标数值 26pt / 700，不与顶部主数据抢视觉中心。 */
  statValue: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statHint: {
    fontSize: 14,
    marginTop: 8,
  },
});
