import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

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

const CHART_HEIGHT = 84;
const DOT_SIZE = 14;
const DOT_BORDER = 3;
const RAIL_HEIGHT = 10;
/** 点在绘图区内的上下留白：点悬空、不贴边、不被裁。 */
const DOT_INSET = 10;

/**
 * “阅读速度”半宽卡（视觉稿还原版）。
 *
 * 主值忠实显示 Analytics 输出：null → —；不 clamp、不隐藏异常值
 * （数据质量问题留给独立审计，UI 不掩盖）。超长数字用
 * adjustsFontSizeToFit 保证不撑破 layout。
 *
 * 图形是带框线的点状趋势：上下两条浅灰轨道、中间浅蓝底，
 * 7 个等宽 column，每列一个空心圆点（白底蓝圈），vertical position
 * 按当日速度归一化；null day 不画点（不把 null 当 0 落到底部），
 * 但保留 column 占位以维持 7 天位置结构。不连线。
 * 右上 chevron 纯装饰（详情页未实现，卡片不可点）。
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
      <View style={styles.headerRow}>
        <Text style={styles.title}>{uiText.data.readingSpeed}</Text>
        <SymbolView
          name="chevron.right"
          size={14}
          tintColor={tokens.colors.tertiaryLabel}
          weight="semibold"
        />
      </View>
      <View style={styles.rail} accessible={false} />
      <View style={styles.plotWrap} accessible={false}>
        <View style={styles.plotBg} />
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
                  Math.round((1 - norm) * (CHART_HEIGHT - DOT_SIZE - DOT_INSET * 2));
            return (
              <View key={day.dayKey} style={styles.dotColumn}>
                {norm === null ? null : (
                  <View style={[styles.dot, { marginTop }]} />
                )}
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.rail} accessible={false} />
      <View style={styles.valueRow}>
        <Text
          style={styles.value}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {valueText}
        </Text>
        {speed !== null ? <Text style={styles.unit}>{uiText.data.speedUnit}</Text> : null}
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    flex: 1,
    color: cardColors.secondary,
    fontSize: 18,
    fontWeight: '600',
  },
  /** 上下轨道：浅灰圆角细条。 */
  rail: {
    height: RAIL_HEIGHT,
    borderRadius: RAIL_HEIGHT / 2,
    backgroundColor: PlatformColor('tertiarySystemFill'),
  },
  /** 绘图区容器：浅蓝底（独立一层做透明）+ 上层点行。 */
  plotWrap: {
    height: CHART_HEIGHT,
    marginVertical: 6,
  },
  plotBg: {
    ...StyleSheet.absoluteFill,
    borderRadius: 12,
    backgroundColor: cardColors.primary,
    opacity: 0.14,
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
  /** 空心圆点：白底 + 蓝圈。 */
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: DOT_BORDER,
    borderColor: cardColors.primary,
    marginTop: 0,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 10,
  },
  value: {
    color: cardColors.secondary,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  unit: {
    color: tokens.colors.secondaryLabel,
    fontSize: 14,
    marginLeft: 6,
    fontWeight: '500',
  },
});
