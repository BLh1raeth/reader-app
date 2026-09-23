import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { formatDuration } from '../analytics-format';
import { cardColors } from './cardColors';

type ReadingRhythmCardProps = {
  /** 最近 7 个 local calendar day（含今天），最旧 → 今天；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** 今天的 local day key，用于强调当天的柱子。 */
  todayKey: string;
  /** 7 日总量：summary.last7DaysActiveSeconds；null = 未加载。 */
  totalActiveSeconds: number | null;
};

const CHART_HEIGHT = 96;
const BAR_WIDTH = 20;
const ZERO_BAR_HEIGHT = 8;
const MIN_VISIBLE_BAR_HEIGHT = 12;

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** dayKey "YYYY-MM-DD"（本地自然日）→ 周几单字。 */
function weekdayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return WEEKDAY_NAMES[new Date(y, m - 1, d).getDay()];
}

/**
 * Data Tab Core B.2：“阅读节奏”全宽 insight 卡（对应健康 App Sleep Consistency
 * 在信息结构上的角色）。
 *
 * 正文只做确定性事实陈述（无 AI、无评价、无建议）：
 * 有阅读 → “过去 7 天累计阅读 X。”；全零 → “过去 7 天暂无阅读记录。”
 *
 * 图形是比半宽卡更完整的 7 日图：更宽的柱、更大的间距、
 * 每柱下方 weekday label。Y 轴 / 网格 / tooltip 都不要。
 *
 * 与“阅读时长”半宽卡用同一数据源但不同信息层级：
 * 半宽卡 = 极简 spark bars + 总量；本卡 = 完整周结构 + 节奏感。
 */
export function ReadingRhythmCard({ days, todayKey, totalActiveSeconds }: ReadingRhythmCardProps) {
  const list = days ?? [];
  const maxSeconds = Math.max(0, ...list.map((d) => d.activeSeconds));
  const hasAnyReading = list.some((d) => d.activeSeconds > 0);

  const bodyText =
    totalActiveSeconds === null
      ? '—'
      : hasAnyReading
        ? uiText.data.rhythmSummary(formatDuration(totalActiveSeconds))
        : uiText.data.rhythmZero;

  return (
    <DataCard
      accessible
      accessibilityLabel={`${uiText.data.readingRhythm}。${bodyText}`}
    >
      <Text style={styles.title}>{uiText.data.readingRhythm}</Text>
      <Text style={styles.body}>{bodyText}</Text>
      <View style={styles.barsRow} accessible={false}>
        {list.map((day) => {
          const isToday = day.dayKey === todayKey;
          let barHeight = ZERO_BAR_HEIGHT;
          let barStyle = styles.barZero;
          if (day.activeSeconds > 0 && maxSeconds > 0) {
            barHeight = Math.max(
              MIN_VISIBLE_BAR_HEIGHT,
              Math.round((day.activeSeconds / maxSeconds) * CHART_HEIGHT),
            );
            barStyle = isToday ? styles.barToday : styles.barPast;
          }
          return (
            <View key={day.dayKey} style={styles.barColumn}>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, barStyle, { height: barHeight }]} />
              </View>
              <Text style={styles.weekday}>{weekdayLabel(day.dayKey)}</Text>
            </View>
          );
        })}
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  title: {
    color: cardColors.primary,
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
  },
  body: {
    color: tokens.colors.label,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 14,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barFill: {
    width: BAR_WIDTH,
    borderRadius: 6,
  },
  barToday: {
    backgroundColor: cardColors.primary,
  },
  barPast: {
    backgroundColor: cardColors.primary,
    opacity: 0.55,
  },
  barZero: {
    backgroundColor: PlatformColor('tertiarySystemFill'),
  },
  weekday: {
    color: tokens.colors.secondaryLabel,
    fontSize: 12,
    marginTop: 8,
  },
});
