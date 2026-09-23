import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { formatDuration } from '../analytics-format';

type Last7DaysCardProps = {
  /** 最近 7 个 local calendar day（含今天），顺序：最旧 → 今天；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** 今天的 local day key，用于强调当天的柱子。 */
  todayKey: string;
  /** 7 日总量：summary.last7DaysActiveSeconds；null = 未加载。 */
  last7DaysActiveSeconds: number | null;
};

const CHART_HEIGHT = 84;
/** 非零值最小可见高度；0 秒保持 0，明确区分“没读”和“读了几秒”。 */
const MIN_VISIBLE_BAR_HEIGHT = 3;

/** 无障碍短标签：9月17日，不带年份噪音。 */
function shortDateLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return `${m}月${d}日`;
}

/**
 * Data Tab Core B.1：“最近 7 天”半宽柱状图卡。
 *
 * dashboard spark chart：纯 RN View 绘制 7 根 mini bar，无 Y 轴、无刻度、
 * 无交互。空间有限，不显示星期 X 轴（完整语义由整卡 accessibilityLabel 提供）。
 */
export function Last7DaysCard({ days, todayKey, last7DaysActiveSeconds }: Last7DaysCardProps) {
  const list = days ?? [];
  const maxSeconds = Math.max(0, ...list.map((d) => d.activeSeconds));
  const total = last7DaysActiveSeconds === null ? '—' : formatDuration(last7DaysActiveSeconds);

  const accessibilityParts = list
    .map((d) => `${shortDateLabel(d.dayKey)}${formatDuration(d.activeSeconds)}`)
    .join('，');

  return (
    <DataCard
      accessible
      accessibilityLabel={`${uiText.data.last7Days}，总计${total}。${accessibilityParts}`}
    >
      <Text style={styles.title}>{uiText.data.last7Days}</Text>
      <View style={styles.barsRow} accessible={false}>
        {list.map((day) => {
          const isToday = day.dayKey === todayKey;
          let barHeight = 0;
          if (day.activeSeconds > 0 && maxSeconds > 0) {
            barHeight = Math.max(
              MIN_VISIBLE_BAR_HEIGHT,
              Math.round((day.activeSeconds / maxSeconds) * CHART_HEIGHT),
            );
          }
          return (
            <View key={day.dayKey} style={styles.barColumn}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { height: barHeight },
                    isToday ? styles.barFillToday : styles.barFillPast,
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.total}>{total}</Text>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  title: {
    color: tokens.colors.label,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 5,
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
    width: 12,
    borderRadius: 4,
  },
  barFillToday: {
    backgroundColor: PlatformColor('systemBlue'),
  },
  barFillPast: {
    backgroundColor: PlatformColor('tertiarySystemFill'),
  },
  total: {
    color: tokens.colors.secondaryLabel,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 10,
  },
});
