import { StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Circle, G, Svg } from 'react-native-svg';

import { uiText } from '../../../localization';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';
import { formatDuration } from '../analytics-format';

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

const RING_SIZE = 140;
const RING_STROKE = 18;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** 三段弧之间的间隙（px），模仿参考图圆环色段的断开感。 */
const ARC_GAP = 6;

/**
 * 今日阅读主卡（2026-09-24 视觉规范）。
 *
 * 左：蓝色小标题“今日阅读”（+ 装饰 chevron）→ 900 状态大字 →
 * 三行实心色点指标（时长蓝 #3F83F8 / 字数青 #57C7D4 / 摘录橙 #F39A3E）；
 * 右：7 天活跃度圆环——填充比例 = activeDays7 / 7，
 * 三色弧段（青 / 橙 / 蓝）均分填充部分，中心显示 “X/7 天”；
 * 底部分割线 + deterministic 事实型摘要句。
 *
 * 所有数字来自 Analytics 实时数据，不写死。
 * chevron 为纯装饰（详情页未实现，卡片不可点）。
 * zero state 完整显示 0 分钟 / 0 字 / 0 条；圆环全灰、中心 0/7 天。
 */
export function TodayReadingCard({
  activeSeconds,
  forwardCharacters,
  excerptCount,
  activeDays7,
}: TodayReadingCardProps) {
  const theme = useDataTheme();

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
  /** 弧段颜色与左侧三行色点对应：字数青 / 摘录橙 / 时长蓝。 */
  const arcColors = [theme.teal, theme.orange, theme.blue];

  const a11y =
    `今日阅读：${statusText}，时长${durationText}，字数${charsText}，摘录${excerptText}。` +
    (activeDays7 === null ? '' : `最近 7 天有 ${activeDays7} 天进行了阅读。`) +
    summaryText;

  return (
    <DataCard accessible accessibilityLabel={a11y}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.blue }]}>{uiText.data.todayReadingTitle}</Text>
        <SymbolView
          name="chevron.right"
          size={15}
          tintColor={theme.secondaryText}
          weight="semibold"
        />
      </View>

      <View style={styles.bodyRow}>
        <View style={styles.leftCol}>
          <Text
            style={[styles.status, { color: theme.primaryText }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {statusText}
          </Text>

          <View style={styles.metricRow} accessible={false}>
            <View style={[styles.dot, { backgroundColor: theme.durationBlue }]} />
            <Text style={[styles.metricText, { color: theme.primaryText }]}>
              {uiText.data.todayMetricDuration}：{durationText}
            </Text>
          </View>
          <View style={styles.metricRow} accessible={false}>
            <View style={[styles.dot, { backgroundColor: theme.teal }]} />
            <Text style={[styles.metricText, { color: theme.primaryText }]}>
              {uiText.data.todayMetricChars}：{charsText}
            </Text>
          </View>
          <View style={styles.metricRow} accessible={false}>
            <View style={[styles.dot, { backgroundColor: theme.orange }]} />
            <Text style={[styles.metricText, { color: theme.primaryText }]}>
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
              stroke={theme.ringTrack}
              strokeWidth={RING_STROKE}
              fill="none"
            />
            <G rotation={-90} origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}>
              {arcColors.map((color, i) => {
                const start = (i * fraction) / arcColors.length;
                const length = Math.max(
                  0,
                  (fraction / arcColors.length) * RING_CIRCUMFERENCE - ARC_GAP,
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
            <Text style={[styles.ringFraction, { color: theme.primaryText }]}>
              {activeDays7 === null ? '—' : `${activeDays7}/7`}
            </Text>
            <Text style={[styles.ringUnit, { color: theme.primaryText }]}>
              {uiText.data.dayUnit}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.divider }]} />

      <Text style={[styles.summary, { color: theme.primaryText }]}>{summaryText}</Text>
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
    fontSize: 17,
    fontWeight: '800',
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftCol: {
    flex: 1,
    paddingRight: 8,
  },
  /** 状态大字：卡内最大字，900 黑体。 */
  status: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginBottom: 14,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  /** 实心色点。 */
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  metricText: {
    fontSize: 17,
    fontWeight: '700',
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
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  ringUnit: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 18,
    marginBottom: 14,
  },
  summary: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
  },
});
