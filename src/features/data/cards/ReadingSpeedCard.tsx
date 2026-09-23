import { StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { cardColors } from './cardColors';

type ReadingSpeedCardProps = {
  /** summary.last7DaysReadingSpeedCharsPerMinute；null = 未加载或无有效数据。 */
  speed: number | null;
  /** 最近 7 天每天的 readingSpeedCharsPerMinute；null = 未加载。 */
  days: DailyReadingStats[] | null;
};

const CHART_HEIGHT = 64;
const DOT_SIZE = 10;

/**
 * Data Tab Core B.2：“阅读速度”半宽核心卡。
 *
 * 主值忠实显示 Analytics 输出：null → —；不 clamp、不隐藏异常值
 * （数据质量问题留给独立审计，UI 不掩盖）。超长数字用
 * adjustsFontSizeToFit 保证不撑破 layout。
 *
 * 图形是 mini dot trend（模仿健康 App“生命体征”点状趋势感）：
 * 7 个等宽 column，每列一个 dot，vertical position 按当日速度归一化；
 * null day 不画 dot（不把 null 当 0 落到底部），但保留 column 占位
 * 以维持 7 天位置结构。不连线。
 */
export function ReadingSpeedCard({ speed, days }: ReadingSpeedCardProps) {
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
      <Text style={styles.title}>{uiText.data.readingSpeed}</Text>
      <View style={styles.valueRow}>
        <Text
          style={styles.value}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {valueText}
        </Text>
        {speed !== null ? <Text style={styles.unit}>{uiText.data.speedUnit}</Text> : null}
      </View>
      <View style={styles.dotsRow} accessible={false}>
        {list.map((day) => {
          const daySpeed = day.readingSpeedCharsPerMinute;
          // 归一化到 [0,1]：最大速度在顶部；全部相等时居中；null 不画点。
          const norm =
            daySpeed === null ? null : spread > 0 ? (daySpeed - minSpeed) / spread : 0.5;
          const marginTop =
            norm === null ? 0 : Math.round((1 - norm) * (CHART_HEIGHT - DOT_SIZE));
          return (
            <View key={day.dayKey} style={styles.dotColumn}>
              {norm === null ? null : (
                <View style={[styles.dot, { marginTop }]} />
              )}
            </View>
          );
        })}
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  title: {
    color: cardColors.secondary,
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  value: {
    color: cardColors.secondary,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  unit: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
    marginLeft: 4,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: CHART_HEIGHT,
  },
  dotColumn: {
    flex: 1,
    alignItems: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: cardColors.secondary,
  },
});
