import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';

type ReadingActivityCardProps = {
  /** 最近 7 个 local calendar day（含今天）；null = 未加载。 */
  days: DailyReadingStats[] | null;
};

const RING_SIZE = 96;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Data Tab Core B.1：“阅读活跃”环形卡。
 *
 * 语义：最近 7 个自然日中有几天 activeSeconds > 0（真实 part-to-whole 指标，
 * 从已有 DailyReadingStats 派生，不新增数据库统计口径）。不是评分/专注度。
 *
 * 实现：react-native-svg（项目已安装、当前 Development Build 已包含，
 * LibraryScreen 的导入进度环在用同一能力），简单 donut + 中央 4/7。
 * 0/7 时环全部 inactive（不消失）；7/7 全部 active。
 */
export function ReadingActivityCard({ days }: ReadingActivityCardProps) {
  const activeDays = days === null ? null : days.filter((d) => d.activeSeconds > 0).length;
  const progress = activeDays === null ? 0 : activeDays / 7;

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
          {progress > 0 ? (
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={PlatformColor('systemBlue')}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${RING_CIRCUMFERENCE * progress} ${RING_CIRCUMFERENCE}`}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          ) : null}
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
