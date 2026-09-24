import { StyleSheet, Text, View } from 'react-native';

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
};

const CHART_HEIGHT = 88;
const BAR_WIDTH = 8;
/** 非零值最小可见高度；0 秒不画柱子（只留下方圆点），明确区分“没读”。 */
const MIN_VISIBLE_BAR_HEIGHT = 10;
const AXIS_DOT_SIZE = 5;

/** 无障碍短标签：9月17日，不带年份噪音。 */
function shortDateLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return `${m}月${d}日`;
}

/**
 * “阅读时长”半宽卡（2026-09-24 视觉规范）。
 *
 * 极简 7 日 spark bars：今天深蓝（#4A8CFF）强调，其他非零日浅蓝（#8EC5FF），
 * 0 秒不画柱子、只留下方浅灰圆点作 x 轴刻度；底部 7 日总量大号蓝色数字。
 * 所有柱子高度来自真实 activeSeconds，不写死。
 */
export function ReadingTimeCard({ days, todayKey, totalActiveSeconds }: ReadingTimeCardProps) {
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
    >
      <Text style={[styles.title, { color: theme.blue }]}>{uiText.data.totalReadingTime}</Text>
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
              : 0;
            return (
              <View key={day.dayKey} style={styles.barColumn}>
                {hasData ? (
                  <View
                    style={[
                      styles.barFill,
                      {
                        height: barHeight,
                        backgroundColor: isToday ? theme.blue : theme.barLightBlue,
                      },
                    ]}
                  />
                ) : null}
                <View style={[styles.axisDot, { backgroundColor: theme.rail }]} />
              </View>
            );
          })}
        </View>
      </View>
      <Text
        style={[styles.total, { color: theme.blue }]}
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
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 14,
  },
  chart: {
    height: CHART_HEIGHT + AXIS_DOT_SIZE + 8,
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
  /** 每根柱子下方的 x 轴小圆点。 */
  axisDot: {
    width: AXIS_DOT_SIZE,
    height: AXIS_DOT_SIZE,
    borderRadius: AXIS_DOT_SIZE / 2,
    marginTop: 8,
  },
  total: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.4,
    marginTop: 12,
  },
});
