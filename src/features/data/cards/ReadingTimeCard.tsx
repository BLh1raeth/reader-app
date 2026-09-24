import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';
import { formatDuration } from '../analytics-format';

type ReadingTimeCardProps = {
  /** 最近 7 个 local calendar day（含今天），最旧 → 今天；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** 今天的 local day key，用于强调当天的柱子。 */
  todayKey: string;
  /** 7 日总量：summary.last7DaysActiveSeconds；null = 未加载。 */
  totalActiveSeconds: number | null;
  /** 外层可覆盖 DataCard 样式（如半宽卡内边距）。 */
  style?: ViewStyle;
};

const CHART_HEIGHT = 88;
const BAR_WIDTH = 8;
/** 非零值最小可见高度。 */
const MIN_VISIBLE_BAR_HEIGHT = 10;
/** 0 秒日的极浅短柱高度：保留 7 个日期位置，不画成圆点。 */
const EMPTY_BAR_HEIGHT = 6;

/** 无障碍短标签：9月17日，不带年份噪音。 */
function shortDateLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return `${m}月${d}日`;
}

/**
 * “阅读时长”半宽卡（B.6 黑白极简）。
 *
 * 7 日圆角柱：今天 #242424，其他有数据的日期 #8E8E93，
 * 0 秒日显示 #E5E5EA 极浅短柱（保留 7 个日期位置）；底部 7 日总量黑色大数字。
 * 所有柱子高度来自真实 activeSeconds，不写死。
 */
export function ReadingTimeCard({ days, todayKey, totalActiveSeconds, style }: ReadingTimeCardProps) {
  const theme = useDataTheme();
  const list = days ?? [];
  const maxSeconds = Math.max(0, ...list.map((d) => d.activeSeconds));
  const total = totalActiveSeconds === null ? '—' : formatDuration(totalActiveSeconds);

  const accessibilityParts = list
    .map((d) => `${shortDateLabel(d.dayKey)}${formatDuration(d.activeSeconds)}`)
    .join('，');

  return (
    <DataCard
      accessible
      accessibilityLabel={`${uiText.data.totalReadingTime}，过去 7 天总计${total}。${accessibilityParts}`}
      style={style}
    >
      <Text style={[styles.title, { color: theme.primaryText }]}>{uiText.data.totalReadingTime}</Text>
      <View style={styles.chart} accessible={false}>
        <View style={styles.barsRow}>
          {list.map((day) => {
            const isToday = day.dayKey === todayKey;
            const hasData = day.activeSeconds > 0 && maxSeconds > 0;
            const barHeight = hasData
              ? Math.max(
                  MIN_VISIBLE_BAR_HEIGHT,
                  Math.round((day.activeSeconds / maxSeconds) * CHART_HEIGHT),
                )
              : EMPTY_BAR_HEIGHT;
            const barColor = !hasData
              ? theme.chartEmpty
              : isToday
                ? theme.chartPrimary
                : theme.tertiaryText;
            return (
              <View key={day.dayKey} style={styles.barColumn}>
                <View
                  style={[
                    styles.barFill,
                    {
                      height: barHeight,
                      backgroundColor: barColor,
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </View>
      <Text
        style={[styles.total, { color: theme.primaryText }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {total}
      </Text>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
  },
  chart: {
    height: CHART_HEIGHT,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
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
  total: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginTop: 12,
  },
});
