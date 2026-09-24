import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { shortMonthDayLabel, weekdayName } from '../analytics-format';
import { cardColors } from './cardColors';

type RhythmCardProps = {
  /** 最近 7 个 local calendar day（含今天），最旧 → 今天；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** summary.currentStreakDays；null = 未加载。 */
  streakDays: number | null;
  /** summary.totalReadingDays；null = 未加载。 */
  totalDays: number | null;
  /** summary.totalExcerptCount；null = 未加载。 */
  excerptCount: number | null;
};

const BARS_HEIGHT = 110;
const BAR_WIDTH = 26;
/** 0 秒的日子：浅灰短柱，位置可见但不伪装成有数据。 */
const ZERO_BAR_HEIGHT = 34;
/** 非零值最小可见高度。 */
const MIN_VISIBLE_BAR_HEIGHT = 44;

/**
 * 阅读节奏卡（视觉稿还原版，摘要 section 内唯一卡片）。
 *
 * 顶部：书本图标 + 蓝色“阅读节奏”标题；
 * 加粗结论“最近 7 天，你有 X 天进行了阅读。”（X = 7 天内 activeSeconds > 0 的天数）；
 * 三列累计：连续阅读（蓝，当前）/ 阅读天数（青，累计）/ 累计摘录（紫，累计）；
 * 底部 7 天柱状图：有阅读的天蓝色、无阅读的天浅灰，每柱下方 “M/D + 周几”
 * （周几按真实日历计算）。
 *
 * 只消费 Analytics 已有输出，不重算口径、不碰统计逻辑。
 */
export function AccumulationCard({ days, streakDays, totalDays, excerptCount }: RhythmCardProps) {
  const list = days ?? [];
  const maxSeconds = Math.max(0, ...list.map((d) => d.activeSeconds));
  const activeDays7 = list.filter((d) => d.activeSeconds > 0).length;

  const streakText = streakDays === null ? '—' : `${streakDays}${uiText.data.dayUnit}`;
  const daysText = totalDays === null ? '—' : `${totalDays}${uiText.data.dayUnit}`;
  const excerptText = excerptCount === null ? '—' : `${excerptCount}${uiText.data.excerptUnit}`;

  const statement =
    days === null ? '—' : uiText.data.rhythmSummaryRecent(activeDays7);

  return (
    <DataCard
      accessible
      accessibilityLabel={`${uiText.data.readingRhythm}：${statement}` +
        `${uiText.data.currentStreak}${streakText}，${uiText.data.totalReadingDays}${daysText}，${uiText.data.totalExcerptLabel}${excerptText}`}
      style={styles.card}
    >
      <View style={styles.titleRow}>
        <SymbolView
          name="book"
          size={26}
          tintColor={cardColors.primary}
          weight="medium"
        />
        <Text style={styles.title}>{uiText.data.readingRhythm}</Text>
      </View>

      <Text style={styles.statement}>{statement}</Text>

      <View style={styles.divider} />

      <View style={styles.statsRow}>
        <View style={styles.statCol}>
          <Text style={styles.statLabel}>{uiText.data.currentStreak}</Text>
          <Text
            style={[styles.statValue, { color: cardColors.primary }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {streakText}
          </Text>
          <Text style={styles.statHint}>{uiText.data.currentHint}</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={styles.statLabel}>{uiText.data.totalReadingDays}</Text>
          <Text
            style={[styles.statValue, { color: cardColors.secondary }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {daysText}
          </Text>
          <Text style={styles.statHint}>{uiText.data.totalHint}</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={styles.statLabel}>{uiText.data.totalExcerptLabel}</Text>
          <Text
            style={[styles.statValue, { color: cardColors.quaternary }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {excerptText}
          </Text>
          <Text style={styles.statHint}>{uiText.data.totalHint}</Text>
        </View>
      </View>

      <View style={styles.barsBlock} accessible={false}>
        <View style={styles.barsRow}>
          {list.map((day) => {
            const hasReading = day.activeSeconds > 0;
            const barHeight =
              hasReading && maxSeconds > 0
                ? Math.max(
                    MIN_VISIBLE_BAR_HEIGHT,
                    Math.round((day.activeSeconds / maxSeconds) * BARS_HEIGHT),
                  )
                : ZERO_BAR_HEIGHT;
            return (
              <View key={day.dayKey} style={styles.barColumn}>
                <View
                  style={[
                    styles.barFill,
                    hasReading ? styles.barActive : styles.barZero,
                    { height: barHeight },
                  ]}
                />
              </View>
            );
          })}
        </View>
        <View style={styles.labelsRow}>
          {list.map((day) => (
            <View key={day.dayKey} style={styles.labelColumn}>
              <Text style={styles.dateLabel}>{shortMonthDayLabel(day.dayKey)}</Text>
              <Text style={styles.weekdayLabel}>{weekdayName(day.dayKey)}</Text>
            </View>
          ))}
        </View>
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: cardColors.primary,
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 8,
  },
  /** 加粗结论句：页面内唯一的大号黑体陈述。 */
  statement: {
    color: tokens.colors.label,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.colors.separator,
    marginVertical: 16,
  },
  statsRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    color: tokens.colors.secondaryLabel,
    fontSize: 14,
    marginBottom: 6,
  },
  statValue: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statHint: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
    marginTop: 6,
  },
  barsBlock: {
    marginTop: 4,
  },
  barsRow: {
    flexDirection: 'row',
    height: BARS_HEIGHT,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: BAR_WIDTH,
    borderRadius: 8,
  },
  barActive: {
    backgroundColor: cardColors.primary,
  },
  barZero: {
    backgroundColor: PlatformColor('tertiarySystemFill'),
  },
  labelsRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  labelColumn: {
    flex: 1,
    alignItems: 'center',
  },
  dateLabel: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
    fontWeight: '500',
  },
  weekdayLabel: {
    color: tokens.colors.secondaryLabel,
    fontSize: 12,
    marginTop: 2,
  },
});
