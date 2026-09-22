import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import type { DailyReadingStats } from './reading-analytics-types';
import { formatDuration } from './analytics-format';

type SevenDayReadingChartProps = {
  /** 最近 7 个 local calendar day（含今天），顺序：最旧 → 今天。 */
  days: DailyReadingStats[];
  /** 今天的 local day key，用于强调当天的柱子。 */
  todayKey: string;
  /** 7 日总量展示：summary.last7DaysActiveSeconds */
  last7DaysActiveSeconds: number;
};

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;
const CHART_HEIGHT = 120;
/** 非零值最小可见高度：几秒钟阅读也能看到一截，但 0 秒仍保持为 0。 */
const MIN_VISIBLE_BAR_HEIGHT = 3;

/** 从 YYYY-MM-DD 取星期标签（周一起始）。Date 以中午构造，避免时区边界漂移。 */
function weekdayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  const jsDay = date.getDay(); // 0=周日
  return WEEKDAY_LABELS[(jsDay + 6) % 7];
}

/** 无障碍短标签：9月17日 → M月d日，避免年份噪音。 */
function shortDateLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return `${m}月${d}日`;
}

/**
 * Data Tab Core B：最近 7 天阅读时长柱状图。
 *
 * 纯 React Native View 绘制 7 根 vertical bar，无 chart library、无 SVG、无动画。
 * 高度 = activeSeconds / maxActiveSeconds；max = 0 时不除 0（全 0 高度）。
 * 非交互：无点击、无长按、无 tooltip，整个图表只有一条整体 accessibilityLabel。
 */
export function SevenDayReadingChart({
  days,
  todayKey,
  last7DaysActiveSeconds,
}: SevenDayReadingChartProps) {
  const maxSeconds = Math.max(0, ...days.map((d) => d.activeSeconds));

  const accessibilityParts = days
    .map((d) => `${shortDateLabel(d.dayKey)}${formatDuration(d.activeSeconds)}`)
    .join('，');

  return (
    <View
      accessible
      accessibilityLabel={uiText.data.chartAccessibility(accessibilityParts)}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>{uiText.data.last7Days}</Text>
        <Text style={styles.total}>{formatDuration(last7DaysActiveSeconds)}</Text>
      </View>
      <View style={styles.barsRow}>
        {days.map((day) => {
          const isToday = day.dayKey === todayKey;
          let barHeight = 0;
          if (day.activeSeconds > 0 && maxSeconds > 0) {
            barHeight = Math.max(
              MIN_VISIBLE_BAR_HEIGHT,
              Math.round((day.activeSeconds / maxSeconds) * CHART_HEIGHT),
            );
          }
          return (
            <View key={day.dayKey} style={styles.barColumn} importantForAccessibility="no-hide-descendants">
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { height: barHeight },
                    isToday ? styles.barFillToday : styles.barFillPast,
                  ]}
                />
              </View>
              <Text style={[styles.weekday, isToday && styles.weekdayToday]}>
                {weekdayLabel(day.dayKey)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    color: tokens.colors.label,
    fontSize: 20,
    fontWeight: '600',
  },
  total: {
    color: tokens.colors.secondaryLabel,
    fontSize: 15,
    fontWeight: '500',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    height: CHART_HEIGHT,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: 22,
    borderRadius: 6,
  },
  barFillToday: {
    backgroundColor: PlatformColor('systemBlue'),
  },
  barFillPast: {
    backgroundColor: PlatformColor('tertiarySystemFill'),
  },
  weekday: {
    color: tokens.colors.tertiaryLabel,
    fontSize: 12,
    marginTop: 8,
  },
  weekdayToday: {
    color: tokens.colors.label,
    fontWeight: '600',
  },
});
