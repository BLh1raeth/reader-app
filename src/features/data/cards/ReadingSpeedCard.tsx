import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';

type ReadingSpeedCardProps = {
  /** summary.last7DaysReadingSpeedCharsPerMinute；null = 未加载或无有效数据。 */
  speed: number | null;
  /** 最近 7 天每天的 readingSpeed(Min|Max)CharsPerMinute；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** 外层可覆盖 DataCard 样式（如半宽卡内边距）。 */
  style?: ViewStyle;
};

const PLOT_HEIGHT = 84;
/** 柱子在绘图区内的上下留白：不贴边、不被裁。 */
const PLOT_INSET = 10;
const BAR_WIDTH = 10;
/** 区间为 0（一天只有一个有效 session）时的最小可见柱高。 */
const MIN_BAR_HEIGHT = 6;

/**
 * “阅读速度”半宽卡（B.6 黑白极简，仿 iOS 健康“双足支撑时间”）。
 *
 * 区间柱：每根胶囊柱的上界 = 当天最快单 session 速度，下界 = 当天最慢
 * 单 session 速度（与加权平均用同一批 eligible session，不编数据）；
 * 缺数据的天留空。Y 轴按 7 天全局最小/最大拟合（两侧留白），
 * 最新有效天的柱子用 #242424 强调，其余 #E5E5EA。
 * 下方大数字仍是 7 天加权平均速度（Analytics 原值，不 clamp）。
 */
export function ReadingSpeedCard({ speed, days, style }: ReadingSpeedCardProps) {
  const theme = useDataTheme();
  const list = days ?? [];

  const bounds = list.flatMap((d) =>
    d.readingSpeedMinCharsPerMinute !== null && d.readingSpeedMaxCharsPerMinute !== null
      ? [d.readingSpeedMinCharsPerMinute, d.readingSpeedMaxCharsPerMinute]
      : [],
  );
  const hasRanges = bounds.length > 0;
  const dataLo = hasRanges ? Math.min(...bounds) : 0;
  const dataHi = hasRanges ? Math.max(...bounds) : 1;
  const pad = Math.max((dataHi - dataLo) * 0.2, 25);
  const yLo = dataLo - pad;
  const yHi = dataHi + pad;

  const toY = (value: number) =>
    PLOT_HEIGHT - PLOT_INSET - ((value - yLo) / (yHi - yLo)) * (PLOT_HEIGHT - PLOT_INSET * 2);

  /** 最后一个有有效速度区间的下标：该柱用 #242424 强调。 */
  const latestValidIndex = list.reduce(
    (acc, d, i) =>
      d.readingSpeedMinCharsPerMinute !== null && d.readingSpeedMaxCharsPerMinute !== null
        ? i
        : acc,
    -1,
  );

  const valueText = speed === null ? '—' : `${Math.round(speed)}`;
  const a11yValue = speed === null ? '—' : `${Math.round(speed)}字每分钟`;

  return (
    <DataCard accessible accessibilityLabel={`${uiText.data.readingSpeed}，${a11yValue}`} style={style}>
      <Text style={[styles.title, { color: theme.primaryText }]}>{uiText.data.readingSpeed}</Text>
      <View style={styles.plot} accessible={false}>
        <View style={styles.barsRow}>
          {list.map((day, i) => {
            const min = day.readingSpeedMinCharsPerMinute;
            const max = day.readingSpeedMaxCharsPerMinute;
            if (min === null || max === null) {
              return <View key={day.dayKey} style={styles.barColumn} />;
            }
            const rawTop = toY(max);
            const rawHeight = toY(min) - toY(max);
            const barHeight = Math.max(MIN_BAR_HEIGHT, rawHeight);
            // 区间为 0 时把最小柱高中点落在该速度上，不偏上不偏下。
            const top = rawHeight >= MIN_BAR_HEIGHT ? rawTop : toY((min + max) / 2) - MIN_BAR_HEIGHT / 2;
            return (
              <View key={day.dayKey} style={styles.barColumn}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: barHeight,
                      top,
                      backgroundColor:
                        i === latestValidIndex ? theme.chartPrimary : theme.chartEmpty,
                    },
                  ]}
                />
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
  barsRow: {
    flexDirection: 'row',
    height: PLOT_HEIGHT,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  /** 区间胶囊柱：上界 = 当天最快，下界 = 当天最慢。 */
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
