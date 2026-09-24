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
/**
 * 三同心圆环（本轮为固定演示比例，不接真实数据；UI 稳定后接入每日目标完成率）。
 * 外环阅读时长 #111111 / 中环阅读字数 #3A3A3C / 内环摘录数量 #6E6E73。
 * 半径按线宽 18、环间距 2px 排布：61 / 41 / 21。
 */
const DEMO_RINGS = [
  { radius: 61, color: '#111111', fraction: 0.65 },
  { radius: 41, color: '#3A3A3C', fraction: 0.4 },
  { radius: 21, color: '#6E6E73', fraction: 0.8 },
];

/**
 * 今日阅读主卡（2026-09-24 视觉规范）。
 *
 * 左：小标题“今日阅读”（#111111 18pt / 700）→ 状态大字（34pt / 800）→
 * 三行灰阶指标点（时长 #111111 / 字数 #3A3A3C / 摘录 #6E6E73，与三环灰度对应）；
 * 右：三同心圆环（B.6 完整保留，不动）；
 * 右：三同心圆环——外环阅读时长（#111111）/ 中环阅读字数（#3A3A3C）/
 * 内环摘录数量（#6E6E73）；本轮固定演示比例 65% / 40% / 80%，中心文字暂空；
 * 真实数据与每日目标完成率下一轮 UI 稳定后再接入。
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

  const a11y =
    `今日阅读：${statusText}，时长${durationText}，字数${charsText}，摘录${excerptText}。` +
    (activeDays7 === null ? '' : `最近 7 天有 ${activeDays7} 天进行了阅读。`);

  return (
    <DataCard accessible accessibilityLabel={a11y}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.primaryText }]}>{uiText.data.todayReadingTitle}</Text>
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
            <View style={[styles.dot, { backgroundColor: '#111111' }]} />
            <Text style={[styles.metricName, { color: theme.secondaryText }]}>
              {uiText.data.todayMetricDuration}：
              <Text style={[styles.metricValue, { color: theme.primaryText }]}>
                {durationText}
              </Text>
            </Text>
          </View>
          <View style={styles.metricRow} accessible={false}>
            <View style={[styles.dot, { backgroundColor: '#3A3A3C' }]} />
            <Text style={[styles.metricName, { color: theme.secondaryText }]}>
              {uiText.data.todayMetricChars}：
              <Text style={[styles.metricValue, { color: theme.primaryText }]}>
                {charsText}
              </Text>
            </Text>
          </View>
          <View style={styles.metricRow} accessible={false}>
            <View style={[styles.dot, { backgroundColor: '#6E6E73' }]} />
            <Text style={[styles.metricName, { color: theme.secondaryText }]}>
              {uiText.data.todayMetricExcerpts}：
              <Text style={[styles.metricValue, { color: theme.primaryText }]}>
                {excerptText}
              </Text>
            </Text>
          </View>
        </View>

        <View style={styles.ringWrap} accessible={false}>
          <Svg width={RING_SIZE} height={RING_SIZE}>
            {DEMO_RINGS.map((ring) => {
              const circumference = 2 * Math.PI * ring.radius;
              const arcLength = Math.max(0, ring.fraction * circumference);
              return (
                <G
                  key={ring.color}
                  rotation={-90}
                  origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
                >
                  <Circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={ring.radius}
                    stroke={theme.ringTrack}
                    strokeWidth={RING_STROKE}
                    fill="none"
                  />
                  {arcLength > 0 && (
                    <Circle
                      cx={RING_SIZE / 2}
                      cy={RING_SIZE / 2}
                      r={ring.radius}
                      stroke={ring.color}
                      strokeWidth={RING_STROKE}
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray={`${arcLength} ${circumference - arcLength}`}
                    />
                  )}
                </G>
              );
            })}
          </Svg>
        </View>
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
    fontSize: 18,
    fontWeight: '700',
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftCol: {
    flex: 1,
    paddingRight: 8,
  },
  /** 状态大字：卡内最大字，34pt / 800。 */
  status: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.7,
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
  /** 指标名称（#636366）与数值（#111111）分开着色。 */
  metricName: {
    fontSize: 17,
    fontWeight: '600',
  },
  metricValue: {
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
});
