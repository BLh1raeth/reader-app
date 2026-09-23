import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { activityRingPalette } from './cardColors';

type ReadingActivityCardProps = {
  /** 最近 7 个 local calendar day（含今天）；null = 未加载。 */
  days: DailyReadingStats[] | null;
};

const RING_SIZE = 96;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** 每段占 1/7 圆周；相邻色段之间留小间隙（模仿健康 App 多色环）。 */
const SEGMENT_ARC = RING_CIRCUMFERENCE / 7;
const SEGMENT_GAP = RING_CIRCUMFERENCE * 0.03;
const SEGMENT_LENGTH = Math.max(0, SEGMENT_ARC - SEGMENT_GAP);

/**
 * Data Tab Core B.1：“阅读活跃”环形卡。
 *
 * 语义：最近 7 个自然日中有几天 activeSeconds > 0（真实 part-to-whole 指标，
 * 从已有 DailyReadingStats 派生，不新增数据库统计口径）。不是评分/专注度。
 *
 * 视觉：模仿健康 App 睡眠评分的多色分段环——有阅读的每一天占一段 1/7 弧，
 * 按天顺序（最旧 → 今天）顺时针从顶部排起，颜色循环取自调色板；
 * 下面一层是完整的浅色底环。0/7 时只有底环（不消失）；7/7 七段全满。
 *
 * 实现：react-native-svg（项目已安装、当前 Development Build 已包含，
 * LibraryScreen 的导入进度环在用同一能力），中央 N / 7。
 */
export function ReadingActivityCard({ days }: ReadingActivityCardProps) {
  /** 有阅读的天在 7 天列表里的下标（最旧 → 今天），null = 未加载。 */
  const activeIndexes =
    days === null
      ? null
      : days
          .map((day, index) => (day.activeSeconds > 0 ? index : -1))
          .filter((index) => index >= 0);
  const activeDays = activeIndexes === null ? null : activeIndexes.length;

  const centerText = activeDays === null ? '—' : `${activeDays}`;

  return (
    <DataCard
      accessible
      accessibilityLabel={
        activeDays === null
          ? `${uiText.data.readingActivity}，${uiText.data.last7Days}`
          : `最近7天有${activeDays}天阅读`
      }
    >
      <Text style={styles.title}>{uiText.data.readingActivity}</Text>
      <View style={styles.ringWrap} accessible={false}>
        <Svg width={RING_SIZE} height={RING_SIZE}>
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={PlatformColor('tertiarySystemFill')}
            strokeWidth={RING_STROKE}
            fill="none"
          />
          {activeIndexes === null || SEGMENT_LENGTH <= 0
            ? null
            : activeIndexes.map((index) => (
                <Circle
                  key={index}
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  stroke={activityRingPalette[index % activityRingPalette.length]}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${SEGMENT_LENGTH} ${RING_CIRCUMFERENCE}`}
                  strokeDashoffset={-(index * SEGMENT_ARC)}
                  transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                />
              ))}
        </Svg>
        <View style={styles.centerLabel}>
          <Text style={styles.centerValue}>{centerText}</Text>
          <Text style={styles.centerDenominator}>/ 7</Text>
        </View>
      </View>
      <Text style={styles.caption}>{uiText.data.last7Days}</Text>
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
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  centerLabel: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  centerValue: {
    color: tokens.colors.label,
    fontSize: 26,
    fontWeight: '700',
  },
  centerDenominator: {
    color: tokens.colors.secondaryLabel,
    fontSize: 14,
    marginLeft: 3,
  },
  caption: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
});
