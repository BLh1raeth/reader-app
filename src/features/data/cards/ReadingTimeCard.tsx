import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { uiText } from '../../../localization';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';
import { formatDuration } from '../analytics-format';

type ReadingTimeCardProps = {
  /** 今天 24 个设备本地小时的 activeSeconds（顺序 0..23，零填充）；null = 未加载。 */
  hourlyActiveSeconds: number[] | null;
  /** 外层可覆盖 DataCard 样式（如半宽卡内边距）。 */
  style?: ViewStyle;
};

const CHART_HEIGHT = 88;
const BAR_WIDTH = 4;
/** 非零值最小可见高度（细柱）。 */
const MIN_VISIBLE_BAR_HEIGHT = 8;
/** X 轴刻度小时：与淡网格线对齐。 */
const AXIS_HOURS = [0, 6, 12, 18];
/** X 轴刻度标签宽度：配合 translateX(-50%) 让文字居中对齐竖线。 */
const AXIS_LABEL_WIDTH = 44;

/**
 * “阅读时段”半宽卡（B.6 黑白极简，模仿 iOS 健身“步数”卡）。
 *
 * 标题 → 24 小时细柱（有阅读的小时 #242424，无数据的小时留空，
 * 只剩 0/6/12/18 时淡网格线 + 刻度）。
 * 所有柱子高度来自真实 session 数据按小时分桶，不写死。
 */
export function ReadingTimeCard({ hourlyActiveSeconds, style }: ReadingTimeCardProps) {
  const theme = useDataTheme();
  const buckets = hourlyActiveSeconds ?? new Array<number>(24).fill(0);
  const maxSeconds = Math.max(0, ...buckets);

  const activeHours = buckets
    .map((seconds, hour) => ({ hour, seconds }))
    .filter(({ seconds }) => seconds > 0)
    .map(({ hour, seconds }) => `${hour}时${formatDuration(Math.round(seconds))}`)
    .join('，');

  const accessibilityLabel =
    `${uiText.data.totalReadingTime}。` +
    (activeHours.length > 0 ? `活跃时段：${activeHours}。` : '今天还没有阅读记录。');

  return (
    <DataCard accessible accessibilityLabel={accessibilityLabel} style={style}>
      <Text style={[styles.title, { color: theme.primaryText }]}>
        {uiText.data.totalReadingTime}
      </Text>

      <View style={styles.chartBlock} accessible={false}>
        <View style={styles.chart} accessible={false}>
          {AXIS_HOURS.map((hour) => (
            <View
              key={hour}
              style={[
                styles.gridLine,
                { left: `${(hour / 24) * 100}%`, backgroundColor: theme.chartEmpty },
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
                    <View
                      style={[
                        styles.barFill,
                        { height: barHeight, backgroundColor: theme.chartPrimary },
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
                { left: `${(hour / 24) * 100}%`, color: theme.secondaryText },
              ]}
            >
              {hour}时
            </Text>
          ))}
        </View>
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
  /**
   * 图表区占满标题下方的剩余空间并垂直居中：与右侧速度卡等高后，
   * 下半部分不再空出一大块。
   */
  chartBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  chart: {
    height: CHART_HEIGHT,
  },
  /** 0/6/12/18 时淡竖线，贯穿图表区。 */
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
});
