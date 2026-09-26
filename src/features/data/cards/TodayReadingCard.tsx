import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
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

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type AnimatedRingProps = {
  size: number;
  radius: number;
  strokeWidth: number;
  color: string;
  /** 目标进度 0–1（本轮为 DEMO_RINGS 的固定演示比例）。 */
  fraction: number;
  trackColor: string;
};

/**
 * 单环入场动画：每次切回数据页时从起点（offset = 整周长，弧不可见）
 * 扫到目标进度，模仿 Apple 健康 / 健身记录圆环的开场效果。
 * 用 Animated 驱动 strokeDashoffset；SVG 属性不支持 native driver，走 JS 线程，
 * 三环体量很小，真机足够流畅。
 */
function AnimatedRing({
  size,
  radius,
  strokeWidth,
  color,
  fraction,
  trackColor,
}: AnimatedRingProps) {
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = useRef(new Animated.Value(circumference)).current;

  useFocusEffect(
    useCallback(() => {
      const animation = Animated.timing(offset, {
        toValue: circumference * (1 - fraction),
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      });
      animation.start();
      return () => {
        animation.stop();
        // 切走时复位到起点：下次切回首帧就是不可见状态，
        // 不会先闪出完整圆环再消失重播。
        offset.setValue(circumference);
      };
    }, [circumference, fraction, offset]),
  );

  return (
    <G rotation={-90} origin={`${center}, ${center}`}>
      <Circle
        cx={center}
        cy={center}
        r={radius}
        stroke={trackColor}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <AnimatedCircle
        cx={center}
        cy={center}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${circumference}`}
        strokeDashoffset={offset}
      />
    </G>
  );
}

/**
 * 今日阅读主卡（2026-09-24 视觉规范）。
 *
 * “今日阅读”标题已移到卡片外，由 DataScreen 按 section 标题（21pt / 800）
 * 统一渲染，与“最近 7 天”一致；卡内只剩内容区：
 * 左：三同心圆环——外环阅读时长（#111111）/ 中环阅读字数（#3A3A3C）/
 * 内环摘录数量（#6E6E73）；本轮固定演示比例 65% / 40% / 80%，中心文字暂空；
 * 右：三行指标文字，名称与数值同色，颜色与三环一一对应
 * （时长 #111111 / 字数 #3A3A3C / 摘录 #6E6E73）；
 * 其中时长行整行放大到 26pt，作为卡内视觉重心；
 * 三行字号：时长 26pt / 字数标签 18pt 数值 22pt / 摘录 14pt；
 * 其中时长行、摘录行冒号前后同字号；
 * 每次切回数据页三环都从起点同步扫到目标进度
 * （Apple 健康式入场动画）；
 * 真实数据与每日目标完成率下一轮 UI 稳定后再接入。
 *
 * 所有数字来自 Analytics 实时数据，不写死。
 * zero state 完整显示 0 分钟 / 0 字 / 0 条；圆环全灰、中心 0/7 天。
 */
export function TodayReadingCard({
  activeSeconds,
  forwardCharacters,
  excerptCount,
  activeDays7,
}: TodayReadingCardProps) {
  const theme = useDataTheme();

  const durationText = activeSeconds === null ? '—' : formatDuration(activeSeconds);
  const charsText =
    forwardCharacters === null ? '—' : `${forwardCharacters}${uiText.data.characterUnit}`;
  const excerptText = excerptCount === null ? '—' : `${excerptCount}${uiText.data.excerptUnit}`;

  const a11y =
    `今日阅读：时长${durationText}，字数${charsText}，摘录${excerptText}。` +
    (activeDays7 === null ? '' : `最近 7 天有 ${activeDays7} 天进行了阅读。`);

  return (
    <DataCard accessible accessibilityLabel={a11y}>
      <View style={styles.bodyRow}>
        <View style={styles.ringWrap} accessible={false}>
          <Svg width={RING_SIZE} height={RING_SIZE}>
            {DEMO_RINGS.map((ring) => (
              <AnimatedRing
                key={ring.color}
                size={RING_SIZE}
                radius={ring.radius}
                strokeWidth={RING_STROKE}
                color={ring.color}
                fraction={ring.fraction}
                trackColor={theme.ringTrack}
              />
            ))}
          </Svg>
        </View>

        <View style={styles.textCol}>
          <View style={styles.metricRow} accessible={false}>
            <Text
              style={[styles.durationName, { color: DEMO_RINGS[0].color }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {uiText.data.todayMetricDuration}：
              <Text style={[styles.durationValue, { color: DEMO_RINGS[0].color }]}>
                {durationText}
              </Text>
            </Text>
          </View>
          {/*
           * 标签与数值拆成两个并列 Text（不嵌套）：两种字号混排时嵌套写法按基线走，
           * 小字看起来往下掉；并列后靠 metricRow 的 alignItems: 'center'
           * 让它们的视觉中心对齐。
           */}
          <View style={styles.metricRow} accessible={false}>
            <Text style={[styles.charsName, { color: DEMO_RINGS[1].color }]}>
              {uiText.data.todayMetricChars}：
            </Text>
            <Text style={[styles.charsValue, { color: DEMO_RINGS[1].color }]}>
              {charsText}
            </Text>
          </View>
          <View style={styles.metricRow} accessible={false}>
            <Text style={[styles.excerptName, { color: DEMO_RINGS[2].color }]}>
              {uiText.data.todayMetricExcerpts}：
            </Text>
            <Text style={[styles.excerptValue, { color: DEMO_RINGS[2].color }]}>
              {excerptText}
            </Text>
          </View>
        </View>
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  /**
   * 文字列与圆环底对齐：三行文字整体下移（之前是居中对齐，视觉偏高）。
   * 行间距保持 16pt 不变。
   */
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  textCol: {
    flex: 1,
    paddingLeft: 8,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  /**
   * 三行标签也跟数值一起渐进：时长 26pt / 字数 18pt / 摘录 14pt，
   * 每行标签比它的数值小 4pt（时长行整行 26pt 是例外，作为视觉重心）。
   */
  charsName: {
    fontSize: 18,
    fontWeight: '500',
  },
  excerptName: {
    fontSize: 14,
    fontWeight: '500',
  },
  /**
   * 三行数值字号渐进：时长 26pt 最大 / 字数 22pt / 摘录 18pt 最小，
   * 与三环由外到内的颜色区分呼应（#111111 / #3A3A3C / #6E6E73）。
   */
  charsValue: {
    fontSize: 22,
    fontWeight: '600',
  },
  excerptValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  /** 时长行：卡内视觉重心，整行放大到 26pt（名称/数值同大，颜色区分）。 */
  durationName: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  durationValue: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
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
