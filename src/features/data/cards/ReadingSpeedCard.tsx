import { useState } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Circle, Line, Polyline, Svg } from 'react-native-svg';

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
/** 点/线在绘图区内的上下留白：不贴边、不被裁。 */
const PLOT_INSET = 10;
const DOT_RADIUS = 3.5;
const LINE_WIDTH = 2;
/** Y 轴 0 起，上限至少 600：固定刻度，不用当周 min/max 归一化，
 *  避免把速度的小抖动视觉放大。 */
const Y_MIN = 0;
const Y_FLOOR = 600;

type PlotPoint = { x: number; y: number; key: string };

/**
 * “阅读速度”半宽卡（B.6 黑白极简，主打简约）。
 *
 * 极简折线：7 天有效速度连成一条细线（#242424），缺数据的天直接断开、
 * 不插值；一条淡虚线标出 7 天平均值（呼应下方大数字）。
 * Y 轴固定 0 起（上限至少 600），小抖动不会被放大——速度本身方差小，
 * 这张图的作用是展示“稳定在什么水平”，而不是波动。
 */
export function ReadingSpeedCard({ speed, days, style }: ReadingSpeedCardProps) {
  const theme = useDataTheme();
  const [plotWidth, setPlotWidth] = useState(0);
  const list = days ?? [];
  const validSpeeds = list
    .map((d) => d.readingSpeedCharsPerMinute)
    .filter((v): v is number => v !== null);
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 0;
  const yMax = Math.max(Y_FLOOR, Math.ceil(maxSpeed / 100) * 100);
  const yRange = Math.max(1, yMax - Y_MIN);

  const toY = (value: number) =>
    PLOT_HEIGHT - PLOT_INSET - ((value - Y_MIN) / yRange) * (PLOT_HEIGHT - PLOT_INSET * 2);
  const toX = (index: number) =>
    ((index + 0.5) / Math.max(1, list.length)) * plotWidth;

  // 连续有效段：null 的天把线断开，不造假。
  const segments: PlotPoint[][] = [];
  const dots: PlotPoint[] = [];
  if (plotWidth > 0) {
    list.forEach((day, i) => {
      const value = day.readingSpeedCharsPerMinute;
      if (value === null) return;
      const point = { x: toX(i), y: toY(value), key: day.dayKey };
      dots.push(point);
      const prevValue = i > 0 ? list[i - 1].readingSpeedCharsPerMinute : null;
      const last = segments[segments.length - 1];
      if (last && prevValue !== null) {
        last.push(point);
      } else {
        segments.push([point]);
      }
    });
  }
  const drawableSegments = segments.filter((seg) => seg.length >= 2);

  const valueText = speed === null ? '—' : `${Math.round(speed)}`;
  const a11yValue = speed === null ? '—' : `${Math.round(speed)}字每分钟`;

  return (
    <DataCard accessible accessibilityLabel={`${uiText.data.readingSpeed}，${a11yValue}`} style={style}>
      <Text style={[styles.title, { color: theme.primaryText }]}>{uiText.data.readingSpeed}</Text>
      <View
        style={styles.plot}
        accessible={false}
        onLayout={(e) => setPlotWidth(e.nativeEvent.layout.width)}
      >
        {plotWidth > 0 ? (
          <Svg width={plotWidth} height={PLOT_HEIGHT}>
            {speed !== null ? (
              <Line
                x1={0}
                y1={toY(speed)}
                x2={plotWidth}
                y2={toY(speed)}
                stroke={theme.chartEmpty}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            ) : null}
            {drawableSegments.map((seg, i) => (
              <Polyline
                key={i}
                points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={theme.chartPrimary}
                strokeWidth={LINE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {dots.map((p) => (
              <Circle key={p.key} cx={p.x} cy={p.y} r={DOT_RADIUS} fill={theme.chartPrimary} />
            ))}
          </Svg>
        ) : null}
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
