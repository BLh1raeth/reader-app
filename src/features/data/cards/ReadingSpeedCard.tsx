import { StyleSheet, Text, View } from 'react-native';

import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';

type ReadingSpeedCardProps = {
  /** summary.last7DaysReadingSpeedCharsPerMinute；null = 未加载或无有效数据。 */
  speed: number | null;
  /** 最近 7 天每天的 readingSpeedCharsPerMinute；null = 未加载。 */
  days: DailyReadingStats[] | null;
};

const PLOT_HEIGHT = 84;
const DOT_SIZE = 12;
/** 点在绘图区内的上下留白：点悬空、不贴边、不被裁。 */
const DOT_INSET = 10;

/**
 * “阅读速度”半宽卡（2026-09-24 视觉规范）。
 *
 * 极简散点图：上下两条很淡的浅灰横线作“轨道感”，中间无边框、无大面积色块；
 * 每天一个青色实心圆点（null 的天不画点，但保留 column 占位维持 7 天结构），
 * 点的 vertical position 按当日速度归一化，点数完全由真实数据驱动。
 *
 * 主值忠实显示 Analytics 输出：null → —；不 clamp、不隐藏异常值
 * （数据质量问题留给独立审计，UI 不掩盖）。超长数字用
 * adjustsFontSizeToFit 保证不撑破 layout。
 */
export function ReadingSpeedCard({ speed, days }: ReadingSpeedCardProps) {
  const theme = useDataTheme();
  const list = days ?? [];
  const validSpeeds = list
    .map((d) => d.readingSpeedCharsPerMinute)
    .filter((v): v is number => v !== null);
  const minSpeed = validSpeeds.length > 0 ? Math.min(...validSpeeds) : 0;
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 0;
  const spread = maxSpeed - minSpeed;

  const valueText = speed === null ? '—' : `${Math.round(speed)}`;
  const a11yValue = speed === null ? '—' : `${Math.round(speed)}字每分钟`;

  return (
    <DataCard accessible accessibilityLabel={`${uiText.data.readingSpeed}，${a11yValue}`}>
      <Text style={[styles.title, { color: theme.teal }]}>{uiText.data.readingSpeed}</Text>
      <View style={styles.plot} accessible={false}>
        <View style={[styles.railLine, { backgroundColor: theme.rail }]} />
        <View style={styles.dotsRow}>
          {list.map((day) => {
            const daySpeed = day.readingSpeedCharsPerMinute;
            // 归一化到 [0,1]：最大速度在顶部；全部相等时居中；null 不画点。
            // 点在上下留白 DOT_INSET 之间游走，悬空不贴边。
            const norm =
              daySpeed === null ? null : spread > 0 ? (daySpeed - minSpeed) / spread : 0.5;
            const marginTop =
              norm === null
                ? 0
                : DOT_INSET +
                  Math.round((1 - norm) * (PLOT_HEIGHT - DOT_SIZE - DOT_INSET * 2));
            return (
              <View key={day.dayKey} style={styles.dotColumn}>
                {norm === null ? null : (
                  <View
                    style={[styles.dot, { backgroundColor: theme.teal, marginTop }]}
                  />
                )}
              </View>
            );
          })}
        </View>
        <View style={[styles.railLine, { backgroundColor: theme.rail }]} />
      </View>
      <View style={styles.valueRow}>
        <Text
          style={[styles.value, { color: theme.teal }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {valueText}
        </Text>
        {speed !== null ? (
          <Text style={[styles.unit, { color: theme.secondaryText }]}>
            {uiText.data.speedUnit}
          </Text>
        ) : null}
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 12,
  },
  plot: {
    height: PLOT_HEIGHT + 16,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  /** 上下轨道：很淡的浅灰横线。 */
  railLine: {
    height: 2,
    borderRadius: 1,
  },
  dotsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  dotColumn: {
    flex: 1,
    alignItems: 'center',
  },
  /** 青色实心散点。 */
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 17,
    marginLeft: 6,
    fontWeight: '600',
  },
});
