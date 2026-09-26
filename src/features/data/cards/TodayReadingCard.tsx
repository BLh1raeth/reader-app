import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Circle, G, Svg } from 'react-native-svg';

import { uiText } from '../../../localization';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';
import { formatDuration } from '../analytics-format';
import type { DailyGoals } from '../goal-repository';

type TodayReadingCardProps = {
  /** summary.todayActiveSeconds；null = 未加载，显示占位。 */
  activeSeconds: number | null;
  /** summary.todayForwardCharacters；null = 未加载，显示占位。 */
  forwardCharacters: number | null;
  /** summary.todayExcerptCount；null = 未加载，显示占位。 */
  excerptCount: number | null;
  /** 最近 7 个 local day 中 activeSeconds > 0 的天数；null = 未加载。 */
  activeDays7: number | null;
  /** 每日目标；null = 未加载时圆环显示 0。 */
  goals: DailyGoals | null;
  /** 点击三圆环：打开每日目标设置 Sheet。 */
  onRingPress: () => void;
};

const RING_SIZE = 140;
const RING_STROKE = 18;
/**
 * 三同心圆环：外环阅读时长 #111111 / 中环阅读字数 #3A3A3C / 内环摘录数量 #6E6E73。
 * 半径按线宽 18、环间距 2px 排布：61 / 41 / 21。
 * 进度 = 今日实际 / 每日目标；超过 100% 后新的一圈用稍亮一档的同色
 * （lapColor）在原轨道上继续画，视觉封顶 2 圈。
 */
const RINGS = [
  { radius: 61, color: '#111111', lapColor: '#4D4D4F' },
  { radius: 41, color: '#3A3A3C', lapColor: '#707074' },
  { radius: 21, color: '#6E6E73', lapColor: '#A6A6AB' },
];
/** 多圈视觉封顶：base 1 圈 + 亮色 1 圈，超出的不再画（数字文本里有精确值）。 */
const MAX_VISUAL_FRACTION = 2;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type AnimatedRingProps = {
  size: number;
  radius: number;
  strokeWidth: number;
  color: string;
  /** 第二圈颜色（比 color 亮一档，超 100% 后在原轨道上继续画）。 */
  lapColor: string;
  /** 目标进度（今日实际 / 每日目标，可 > 1；视觉封顶 2）。 */
  fraction: number;
  trackColor: string;
};

/**
 * 单环入场动画：每次切回数据页时从起点扫到目标进度，模仿 Apple 健康 /
 * 健身记录圆环的开场效果。超 100% 时扫过整圈后，用 lapColor 在原轨道上
 * 继续画第二圈（多圈效果），两圈共用一次 900ms 的连续扫动。
 * 用 Animated 驱动 strokeDashoffset；SVG 属性不支持 native driver，走 JS 线程，
 * 三环体量很小，真机足够流畅。
 */
function AnimatedRing({
  size,
  radius,
  strokeWidth,
  color,
  lapColor,
  fraction,
  trackColor,
}: AnimatedRingProps) {
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      progress.setValue(0);
      const animation = Animated.timing(progress, {
        toValue: fraction,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      });
      animation.start();
      return () => {
        animation.stop();
        // 切走时复位到起点：下次切回首帧就是不可见状态，
        // 不会先闪出完整圆环再消失重播。
        progress.setValue(0);
      };
    }, [fraction, progress]),
  );

  /** 第一圈：progress 0→1 映射到 offset 周长→0，超 1 后保持整圈。 */
  const baseOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
    extrapolate: 'clamp',
  });
  /** 第二圈：progress 1→2 映射到 offset 周长→0，用亮色画在原轨道上。 */
  const lapOffset = progress.interpolate({
    inputRange: [1, 2],
    outputRange: [circumference, 0],
    extrapolate: 'clamp',
  });

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
        strokeDashoffset={baseOffset}
      />
      {fraction > 1 ? (
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          stroke={lapColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={lapOffset}
        />
      ) : null}
    </G>
  );
}

/**
 * 今日阅读主卡（2026-09-24 视觉规范）。
 *
 * “今日阅读”标题已移到卡片外，由 DataScreen 按 section 标题（21pt / 800）
 * 统一渲染，与“最近 7 天”一致；卡内只剩内容区：
 * 左：三同心圆环——外环阅读时长（#111111）/ 中环阅读字数（#3A3A3C）/
 * 内环摘录数量（#6E6E73）；进度 = 今日实际 / 每日目标（超目标封顶 1），
 * 点击圆环打开每日目标设置 Sheet；
 * 右：三行指标文字，名称与数值同色，颜色与三环一一对应
 * （时长 #111111 / 字数 #3A3A3C / 摘录 #6E6E73）；
 * 其中时长行整行放大到 26pt，作为卡内视觉重心；
 * 三行冒号前后同字号：时长 26pt / 字数 18pt / 摘录 14pt；
 * 三行标签定宽 52pt，数值左对齐（与时长行数值位置对齐）；
 * 每次切回数据页三环都从起点同步扫到目标进度
 * （Apple 健康式入场动画）。
 *
 * 所有数字来自 Analytics 实时数据，不写死。
 * zero state 完整显示 0 分钟 / 0 字 / 0 条；圆环全灰、中心 0/7 天。
 */
export function TodayReadingCard({
  activeSeconds,
  forwardCharacters,
  excerptCount,
  activeDays7,
  goals,
  onRingPress,
}: TodayReadingCardProps) {
  const theme = useDataTheme();

  const durationText = activeSeconds === null ? '—' : formatDuration(activeSeconds);
  const charsText =
    forwardCharacters === null ? '—' : `${forwardCharacters}${uiText.data.characterUnit}`;
  const excerptText = excerptCount === null ? '—' : `${excerptCount}${uiText.data.excerptUnit}`;

  /** 三环进度 = 今日实际 / 每日目标，可超 1；视觉封顶 2 圈。目标未加载时为 0。 */
  const clampVisual = (v: number) => Math.min(MAX_VISUAL_FRACTION, Math.max(0, v));
  const ringFractions =
    goals === null
      ? [0, 0, 0]
      : [
          activeSeconds === null ? 0 : clampVisual(activeSeconds / goals.targetSeconds),
          forwardCharacters === null ? 0 : clampVisual(forwardCharacters / goals.targetChars),
          excerptCount === null ? 0 : clampVisual(excerptCount / goals.targetExcerpts),
        ];

  const a11y =
    `今日阅读：时长${durationText}，字数${charsText}，摘录${excerptText}。` +
    (activeDays7 === null ? '' : `最近 7 天有 ${activeDays7} 天进行了阅读。`);

  return (
    <DataCard accessible accessibilityLabel={a11y}>
      <View style={styles.bodyRow}>
        <View style={styles.ringWrap} accessible={false}>
          <Pressable
            accessibilityLabel={uiText.data.goalSheetTitle}
            accessibilityRole="button"
            onPress={onRingPress}
          >
            <Svg width={RING_SIZE} height={RING_SIZE}>
              {RINGS.map((ring, index) => (
                <AnimatedRing
                  key={ring.color}
                  size={RING_SIZE}
                  radius={ring.radius}
                  strokeWidth={RING_STROKE}
                  color={ring.color}
                  lapColor={ring.lapColor}
                  fraction={ringFractions[index]}
                  trackColor={theme.ringTrack}
                />
              ))}
            </Svg>
          </Pressable>
        </View>

        <View style={styles.textCol}>
          <View style={styles.metricRow} accessible={false}>
            <Text style={[styles.durationLabel, { color: RINGS[0].color }]}>
              {uiText.data.todayMetricDuration}
            </Text>
            <Text
              style={[styles.durationValue, { color: RINGS[0].color }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {durationText}
            </Text>
          </View>
          {/*
           * 标签与数值拆成两个并列 Text（不嵌套）：两种字号混排时嵌套写法按基线走，
           * 小字看起来往下掉；并列后靠 metricRow 的 alignItems: 'center'
           * 让它们的视觉中心对齐。
           */}
          <View style={styles.metricRow} accessible={false}>
            <Text style={[styles.charsName, { color: RINGS[1].color }]}>
              {uiText.data.todayMetricChars}
            </Text>
            <Text style={[styles.charsValue, { color: RINGS[1].color }]}>
              {charsText}
            </Text>
          </View>
          <View style={styles.metricRow} accessible={false}>
            <Text style={[styles.excerptName, { color: RINGS[2].color }]}>
              {uiText.data.todayMetricExcerpts}
            </Text>
            <Text style={[styles.excerptValue, { color: RINGS[2].color }]}>
              {excerptText}
            </Text>
          </View>
        </View>
      </View>
    </DataCard>
  );
}

/**
 * 三行标签定宽 52pt = “时长”在 26pt 下的自然宽度（2 个全角字符 × 26pt），
 * 保证三行数值左对齐。字数/摘录标签字号虽小，盒子撑满 52pt。
 */
const METRIC_LABEL_WIDTH = 52;

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
   * 三行标签定宽：取最宽的“时长”（26pt × 2 个全角字符 = 52pt），
   * 三行数值左对齐到同一 x（与时长行数值位置对齐）。
   */
  charsName: {
    fontSize: 18,
    fontWeight: '500',
    width: METRIC_LABEL_WIDTH,
  },
  excerptName: {
    fontSize: 14,
    fontWeight: '500',
    width: METRIC_LABEL_WIDTH,
  },
  /**
   * 三行数值字号渐进：时长 26pt 最大 / 字数 22pt / 摘录 18pt 最小，
   * 与三环由外到内的颜色区分呼应（#111111 / #3A3A3C / #6E6E73）。
   */
  charsValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  excerptValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  /** 时长行：卡内视觉重心，整行放大到 26pt（名称/数值同大，颜色区分）。 */
  durationLabel: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    width: METRIC_LABEL_WIDTH,
  },
  durationValue: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    flex: 1,
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
