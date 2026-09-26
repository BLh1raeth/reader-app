import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';

type ReadingSpeedCardProps = {
  /** summary.last7DaysReadingSpeedCharsPerMinute；null = 未加载或无有效数据。 */
  speed: number | null;
  /** 最近 7 天每天的 readingSpeedCharsPerMinute；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** 外层可覆盖 DataCard 样式（如半宽卡内边距）。 */
  style?: ViewStyle;
};

const PLOT_HEIGHT = 84;
const CENTER_Y = PLOT_HEIGHT / 2;
const BAR_WIDTH = 10;
/** 柱子离绘图区上下边缘的留白。 */
const BAR_INSET = 8;

/**
 * “阅读速度”半宽卡（B.6 黑白极简，仿 iOS 健康“双足支撑时间”）。
 *
 * 双向圆头柱：中线 = 7 天平均速度（淡线），每天一根胶囊柱从中线出发——
 * 高于平均的朝上、低于平均的朝下，柱长按当天偏离占最大偏离的比例算；
 * 缺数据的天留空不断开。最新有效天的柱子用 #242424 强调，其余 #E5E5EA。
 * 下方大数字仍是 7 天平均速度（Analytics 原值，不 clamp）。
 */
export function ReadingSpeedCard({ speed, days, style }: ReadingSpeedCardProps) {
  const theme = useDataTheme();
  const list = days ?? [];

  /** 每天相对 7 天平均的偏离；缺数据或平均值缺失时为 null。 */
  const deviations: (number | null)[] = list.map((d) =>
    d.readingSpeedCharsPerMinute === null || speed === null
      ? null
      : d.readingSpeedCharsPerMinute - speed,
  );
  const maxAbsDeviation = Math.max(
    0,
    ...deviations.filter((d): d is number => d !== null).map((d) => Math.abs(d)),
  );
  /** 最后一个有有效速度的下标：该柱用 #242424 强调。 */
  const latestValidIndex = list.reduce(
    (acc, d, i) => (d.readingSpeedCharsPerMinute !== null ? i : acc),
    -1,
  );

  const maxBarHalf = CENTER_Y - BAR_INSET;

  const valueText = speed === null ? '—' : `${Math.round(speed)}`;
  const a11yValue = speed === null ? '—' : `${Math.round(speed)}字每分钟`;

  return (
    <DataCard accessible accessibilityLabel={`${uiText.data.readingSpeed}，${a11yValue}`} style={style}>
      <Text style={[styles.title, { color: theme.primaryText }]}>{uiText.data.readingSpeed}</Text>
      <View style={styles.plot} accessible={false}>
        {speed !== null ? (
          <View
            style={[
              styles.centerLine,
              { top: CENTER_Y - 1, backgroundColor: theme.chartEmpty },
            ]}
          />
        ) : null}
        <View style={styles.barsRow}>
          {list.map((day, i) => {
            const deviation = deviations[i];
            const barHeight =
              deviation === null || maxAbsDeviation === 0
                ? 0
                : Math.round((Math.abs(deviation) / maxAbsDeviation) * maxBarHalf);
            return (
              <View key={day.dayKey} style={styles.barColumn}>
                {barHeight > 0 ? (
                  <View
                    style={[
                      styles.bar,
                      {
                        height: barHeight,
                        top: deviation !== null && deviation < 0 ? CENTER_Y : CENTER_Y - barHeight,
                        backgroundColor:
                          i === latestValidIndex ? theme.chartPrimary : theme.chartEmpty,
                      },
                    ]}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.valueRow}>
        <Text
          style={[styles.value, { color: theme.primaryText }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {valueText}
        </Text>
        {speed !== null ? (
          <Text style={[styles.unit, { color: theme.tertiaryText }]}>
            {uiText.data.speedUnit}
          </Text>
        ) : null}
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  plot: {
    height: PLOT_HEIGHT,
    marginBottom: 12,
  },
  /** 中线 = 7 天平均速度。 */
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
  },
  barsRow: {
    flexDirection: 'row',
    height: PLOT_HEIGHT,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  /** 双向胶囊柱：从中线向上或向下生长。 */
  bar: {
    position: 'absolute',
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
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
});
