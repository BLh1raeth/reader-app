import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Circle, G, Svg } from 'react-native-svg';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import { DataCard } from '../DataCard';
import { formatDuration } from '../analytics-format';
import { cardColors } from './cardColors';

type TodayReadingCardProps = {
  /** summary.todayActiveSeconds；null = 未加载，显示占位。 */
  activeSeconds: number | null;
  /** summary.todayForwardCharacters；null = 未加载，显示占位。 */
  forwardCharacters: number | null;
  /** summary.todayExcerptCount；null = 未加载，显示占位。 */
  excerptCount: number | null;
  /** 最近 7 个 local day 中 activeSeconds > 0 的天数；null = 未加载。 */
  activeDays7: number | null;
};

const RING_SIZE = 148;
const RING_STROKE = 18;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** 三段弧之间的间隙（px），模仿视觉稿圆环色段的断开感。 */
const ARC_GAP = 6;
/** 弧段颜色与左侧三行色点一一对应：时长蓝 / 字数青 / 摘录橙。 */
const ARC_COLORS = [cardColors.secondary, cardColors.tertiary, cardColors.primary];

/**
 * 今日阅读主卡（视觉稿还原版）。
 *
 * 左：状态词（纯时长档位）+ 三行色点指标（时长蓝 / 字数青 / 摘录橙）；
 * 右：7 天活跃度圆环——填充比例 = 最近 7 天有阅读的天数 / 7，
 * 三色弧段均分填充部分（与左侧三行颜色对应），中心显示 “X/7 天”。
 * 底部一句 deterministic 事实型摘要：
 * - 字数 > 0 且摘录 > 0 → “今天你已经阅读了 X 字，并记录了 Y 条摘录。”
 * - 其余沿用 B.3 四条规则（0 秒 / 有字 / 有摘录 / 只有时长）。
 *
 * chevron 为纯装饰（详情页未实现，卡片不可点），与 DataCard 注释一致。
 * zero state 完整显示 0 分钟 / 0 字 / 0 条；圆环全灰、中心 0/7 天。
 */
export function TodayReadingCard({
  activeSeconds,
  forwardCharacters,
  excerptCount,
  activeDays7,
}: TodayReadingCardProps) {
  const loaded =
    activeSeconds !== null &&
    forwardCharacters !== null &&
    excerptCount !== null &&
    activeDays7 !== null;

  const statusText =
    activeSeconds === null
      ? '—'
      : activeSeconds === 0
        ? uiText.data.todayStatusZero
        : activeSeconds < 60
          ? uiText.data.todayStatusJustStarted
          : activeSeconds < 1800
            ? uiText.data.todayStatusSteady
            : uiText.data.todayStatusDeep;

  const durationText = activeSeconds === null ? '—' : formatDuration(activeSeconds);
  const charsText =
    forwardCharacters === null ? '—' : `${forwardCharacters}${uiText.data.characterUnit}`;
  const excerptText = excerptCount === null ? '—' : `${excerptCount}${uiText.data.excerptUnit}`;

  const summaryText = !loaded
    ? '—'
    : activeSeconds === 0
      ? uiText.data.todaySummaryZero
      : forwardCharacters > 0 && excerptCount > 0
        ? uiText.data.todaySummaryCharsAndExcerpts(forwardCharacters, excerptCount)
        : forwardCharacters > 0
          ? uiText.data.todaySummaryChars(forwardCharacters)
          : excerptCount > 0
            ? uiText.data.todaySummaryExcerpts(excerptCount)
            : uiText.data.todaySummaryDuration(durationText);

  const fraction = activeDays7 === null ? 0 : Math.min(1, Math.max(0, activeDays7 / 7));

  const a11y =
    `今日阅读：${statusText}，时长${durationText}，字数${charsText}，摘录${excerptText}。` +
    (activeDays7 === null ? '' : `最近 7 天有 ${activeDays7} 天进行了阅读。`) +
    summaryText;

  return (
    <DataCard accessible accessibilityLabel={a11y} style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{uiText.data.todayReadingTitle}</Text>
        <SymbolView
          name="chevron.right"
          size={15}
          tintColor={tokens.colors.tertiaryLabel}
          weight="semibold"
        />
      </View>

      <View style={styles.bodyRow}>
        <View style={styles.leftCol}>
          <Text
            style={styles.status}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {statusText}
          </Text>

          <View style={styles.metricRow} accessible={false}>
            <View style={[styles.dot, { backgroundColor: cardColors.primary }]} />
            <Text style={styles.metricText}>
              {uiText.data.todayMetricDuration}：{durationText}
            </Text>
          </View>
          <View style={styles.metricRow} accessible={false}>
            <View style={[styles.dot, { backgroundColor: cardColors.secondary }]} />
            <Text style={styles.metricText}>
              {uiText.data.todayMetricChars}：{charsText}
            </Text>
          </View>
          <View style={styles.metricRow} accessible={false}>
            <View style={[styles.dot, { backgroundColor: cardColors.tertiary }]} />
            <Text style={styles.metricText}>
              {uiText.data.todayMetricExcerpts}：{excerptText}
            </Text>
          </View>
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
            <G rotation={-90} origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}>
              {ARC_COLORS.map((color, i) => {
                const start = (i * fraction) / ARC_COLORS.length;
                const length = Math.max(
                  0,
                  (fraction / ARC_COLORS.length) * RING_CIRCUMFERENCE - ARC_GAP,
                );
                if (length <= 0) return null;
                return (
                  <Circle
                    key={i}
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    stroke={color}
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={`${length} ${RING_CIRCUMFERENCE - length}`}
                    strokeDashoffset={-start * RING_CIRCUMFERENCE}
                  />
                );
              })}
            </G>
          </Svg>
          <View style={styles.ringCenter}>
            <Text style={styles.ringFraction}>
              {activeDays7 === null ? '—' : `${activeDays7}/7`}
            </Text>
            <Text style={styles.ringUnit}>{uiText.data.dayUnit}</Text>
          </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    flex: 1,
    color: cardColors.primary,
    fontSize: 20,
    fontWeight: '600',
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftCol: {
    flex: 1,
    paddingRight: 8,
  },
  /** 状态词：卡内最大字，黑体粗。 */
  status: {
    color: tokens.colors.label,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 10,
  },
  metricText: {
    color: tokens.colors.label,
    fontSize: 18,
    fontWeight: '600',
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
  },
  ringFraction: {
    color: tokens.colors.label,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  ringUnit: {
    color: tokens.colors.label,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.colors.separator,
    marginTop: 16,
    marginBottom: 14,
  },
  summary: {
    color: tokens.colors.label,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '500',
  },
});
