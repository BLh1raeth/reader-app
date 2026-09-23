import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { formatDuration } from '../analytics-format';
import { cardColors, overviewRingPalette } from './cardColors';

type OverviewCardProps = {
  /** summary.last7DaysActiveSeconds；null = 未加载，显示占位。 */
  totalActiveSeconds: number | null;
  /** 最近 7 个 local calendar day（含今天），最旧 → 今天；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** summary.totalExcerptCount；null = 未加载，显示占位。 */
  excerptCount: number | null;
};

const RING_SIZE = 84;
const RING_STROKE = 9;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** 每段占 1/7 圆周；相邻色段之间留小间隙。 */
const SEGMENT_ARC = RING_CIRCUMFERENCE / 7;
const SEGMENT_GAP = RING_CIRCUMFERENCE * 0.03;
const SEGMENT_LENGTH = Math.max(0, SEGMENT_ARC - SEGMENT_GAP);

/**
 * Data Tab Core B.2：阅读概览主卡（页面唯一的视觉中心）。
 *
 * 层级：
 * 1. 过去 7 天总阅读时长（最醒目，summary.last7DaysActiveSeconds）
 * 2. 右侧阅读活跃环（有阅读的天数 / 7，真实比例，不是评分）
 * 3. 三个轻量信息列：阅读时长 / 活跃天数 / 摘录（纯文本三列，无嵌套卡）
 * 4. divider 下一句事实型摘要（无价值判断）
 *
 * 今天的数据本轮不占主卡位置（详情页以后再做日维度）。
 */
export function OverviewCard({ totalActiveSeconds, days, excerptCount }: OverviewCardProps) {
  const activeIndexes =
    days === null
      ? null
      : days
          .map((day, index) => (day.activeSeconds > 0 ? index : -1))
          .filter((index) => index >= 0);
  const activeDays = activeIndexes === null ? null : activeIndexes.length;

  const bigValue = totalActiveSeconds === null ? '—' : formatDuration(totalActiveSeconds);
  const durationText = totalActiveSeconds === null ? '—' : formatDuration(totalActiveSeconds);
  const activeDaysText = activeDays === null ? '—' : `${activeDays} / 7`;
  const excerptText = excerptCount === null ? '—' : `${excerptCount}${uiText.data.excerptUnit}`;
  const summaryText =
    activeDays === null
      ? '—'
      : activeDays > 0
        ? uiText.data.overviewSummary(activeDays)
        : uiText.data.overviewZero;

  return (
    <DataCard
      accessible
      accessibilityLabel={`阅读概览，过去 7 天阅读${bigValue}，有${activeDays === null ? '—' : activeDays}天阅读，摘录${excerptText}。${summaryText}`}
      style={styles.card}
    >
      <Text style={styles.title}>{uiText.data.overview}</Text>

      <View style={styles.mainRow}>
        <View style={styles.mainLeft}>
          <Text style={styles.kicker}>{uiText.data.past7Days}</Text>
          <Text
            style={styles.bigValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {bigValue}
          </Text>
        </View>
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
                    stroke={overviewRingPalette[index % overviewRingPalette.length]}
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
            <Text style={styles.centerValue}>{activeDays === null ? '—' : `${activeDays}`}</Text>
            <Text style={styles.centerDenominator}>/ 7</Text>
          </View>
        </View>
      </View>

      <View style={styles.auxRow}>
        <View style={styles.auxCol}>
          <Text style={styles.auxLabel}>{uiText.data.totalReadingTime}</Text>
          <Text
            style={styles.auxValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {durationText}
          </Text>
        </View>
        <View style={styles.auxCol}>
          <Text style={styles.auxLabel}>{uiText.data.activeDays}</Text>
          <Text style={styles.auxValue} numberOfLines={1} adjustsFontSizeToFit>
            {activeDaysText}
          </Text>
        </View>
        <View style={styles.auxCol}>
          <Text style={styles.auxLabel}>{uiText.data.excerpts}</Text>
          <Text style={styles.auxValue} numberOfLines={1} adjustsFontSizeToFit>
            {excerptText}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <Text style={styles.summary}>{summaryText}</Text>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
  },
  title: {
    color: cardColors.primary,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 14,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mainLeft: {
    flex: 1,
  },
  kicker: {
    color: tokens.colors.secondaryLabel,
    fontSize: 14,
    marginBottom: 6,
  },
  bigValue: {
    color: cardColors.primary,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 40,
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  centerLabel: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  centerValue: {
    color: tokens.colors.label,
    fontSize: 22,
    fontWeight: '700',
  },
  centerDenominator: {
    color: tokens.colors.secondaryLabel,
    fontSize: 12,
    marginLeft: 2,
  },
  auxRow: {
    flexDirection: 'row',
    marginTop: 18,
  },
  auxCol: {
    flex: 1,
  },
  auxLabel: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
    marginBottom: 4,
  },
  auxValue: {
    color: tokens.colors.label,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.colors.separator,
    marginVertical: 14,
  },
  summary: {
    color: tokens.colors.label,
    fontSize: 15,
    lineHeight: 21,
  },
});
