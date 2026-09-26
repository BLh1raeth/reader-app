import { useCallback, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';

type ReadingSpeedCardProps = {
  /**
   * 最新一次 1 分钟速度检测（summary.latestSpeedSample）：
   * 大数字显示它的速度，黑点画在它所在天的柱子上。
   * null = 还没有任何检测。
   */
  latestSpeedSample: { dayKey: string; charsPerMinute: number } | null;
  /** 最近 7 天每天的 readingSpeed(P10|P90)CharsPerMinute；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** 外层可覆盖 DataCard 样式（如半宽卡内边距）。 */
  style?: ViewStyle;
};

const PLOT_HEIGHT = 84;
/** 柱子在绘图区内的上下留白：不贴边、不被裁。 */
const PLOT_INSET = 10;
const BAR_WIDTH = 10;
/** 区间为 0（样本不足）时的最小可见柱高。 */
const MIN_BAR_HEIGHT = 6;
/** 黑点直径 = 柱宽：左右边界与柱子对齐。 */
const DOT_SIZE = BAR_WIDTH;
/** 7 根柱子从左到右的 stagger 间隔：历史先铺，今天最后落定。 */
const STAGGER_MS = 40;
/** 黑点落定动画的起始高度：从柱子上方轻轻落下。 */
const DOT_DROP_DISTANCE = 28;

/**
 * “阅读速度”半宽卡（B.6 黑白极简，仿 iOS 健康“双足支撑时间”）。
 *
 * 区间柱：每根胶囊柱的上界 = 当天 1 分钟速度样本的 P90，下界 = P10
 * （分位数，不用严格 min/max，单个极端分钟拉不动柱子）；
 * 缺数据的天留空。柱子全部浅灰；最新一次检测的速度在它所在天的
 * 柱子上用一个黑色小圆点标出（钳制在柱子范围内）。
 * 下方大数字 = 最新一次检测的速度（字/分钟），不是 7 天平均。
 */
export function ReadingSpeedCard({ latestSpeedSample, days, style }: ReadingSpeedCardProps) {
  const theme = useDataTheme();
  const list = days ?? [];

  /**
   * 图形动画（与圆环 / 时段柱同家族：900ms / Easing.out(cubic) / 切回 Data 页重播）：
   * - 胶囊从中间向上下展开（区间语义：不是从 0 涨起来，是区间确立）；
   * - 黑点在柱子展开过半后从上方落定到最新速度位置；
   * - 7 天从左到右每根晚 40ms，历史先铺、今天最后落定。
   * native driver（transform / opacity）：JS 驱动的 height+top 每帧都要在 JS 线程
   * 算插值、走 bridge、触发 layout，整页一起跑会挤爆 JS 线程导致所有图一起卡；
   * native 驱动全程在 UI 线程跑，JS 每帧零工作。视觉与之前完全一致。
   * 大数字不做滚动（与今日大卡一致）：只做图形动画。
   */
  const columnProgress = useRef(
    Array.from({ length: 7 }, () => new Animated.Value(0)),
  ).current;

  useFocusEffect(
    useCallback(() => {
      columnProgress.forEach((p) => p.setValue(0));
      const all = Animated.parallel(
        columnProgress.map((p, i) =>
          Animated.sequence([
            Animated.delay(i * STAGGER_MS),
            Animated.timing(p, {
              toValue: 1,
              duration: 900,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
      all.start();
      return () => {
        all.stop();
        columnProgress.forEach((p) => p.setValue(0));
      };
    }, [columnProgress]),
  );

  const bounds = list.flatMap((d) =>
    d.readingSpeedP10CharsPerMinute !== null && d.readingSpeedP90CharsPerMinute !== null
      ? [d.readingSpeedP10CharsPerMinute, d.readingSpeedP90CharsPerMinute]
      : [],
  );
  const hasRanges = bounds.length > 0;
  const dataLo = hasRanges ? Math.min(...bounds) : 0;
  const dataHi = hasRanges ? Math.max(...bounds) : 1;
  const pad = Math.max((dataHi - dataLo) * 0.2, 25);
  const yLo = dataLo - pad;
  const yHi = dataHi + pad;

  const toY = (value: number) =>
    PLOT_HEIGHT - PLOT_INSET - ((value - yLo) / (yHi - yLo)) * (PLOT_HEIGHT - PLOT_INSET * 2);

  const valueText = latestSpeedSample === null ? '—' : `${Math.round(latestSpeedSample.charsPerMinute)}`;
  const a11yValue =
    latestSpeedSample === null ? '—' : `最新${Math.round(latestSpeedSample.charsPerMinute)}字每分钟`;

  return (
    <DataCard accessible accessibilityLabel={`${uiText.data.readingSpeed}，${a11yValue}`} style={style}>
      <Text style={[styles.title, { color: theme.primaryText }]}>{uiText.data.readingSpeed}</Text>
      <View style={styles.plot} accessible={false}>
        <View style={styles.barsRow}>
          {list.map((day, index) => {
            const p10 = day.readingSpeedP10CharsPerMinute;
            const p90 = day.readingSpeedP90CharsPerMinute;
            if (p10 === null || p90 === null) {
              return <View key={day.dayKey} style={styles.barColumn} />;
            }
            const rawTop = toY(p90);
            const rawHeight = toY(p10) - toY(p90);
            const barHeight = Math.max(MIN_BAR_HEIGHT, rawHeight);
            const top =
              rawHeight >= MIN_BAR_HEIGHT ? rawTop : toY((p10 + p90) / 2) - MIN_BAR_HEIGHT / 2;
            const barBottom = top + barHeight;
            const progress =
              columnProgress[Math.min(index, columnProgress.length - 1)];

            const isLatestDay =
              latestSpeedSample !== null && latestSpeedSample.dayKey === day.dayKey;
            // 黑点标出最新速度的位置，钳制在柱子范围内不悬空。
            const dotY = isLatestDay
              ? Math.min(barBottom, Math.max(top, toY(latestSpeedSample.charsPerMinute)))
              : null;

            return (
              <View key={day.dayKey} style={styles.barColumn}>
                <Animated.View
                  style={[
                    styles.bar,
                    {
                      height: barHeight,
                      top,
                      backgroundColor: theme.chartEmpty,
                      /** 从中心向上下展开：scaleY 天然以中心为锚点（native driver）。 */
                      transform: [{ scaleY: progress }],
                    },
                  ]}
                />
                {dotY !== null ? (
                  <Animated.View
                    style={[
                      styles.dot,
                      {
                        top: dotY - DOT_SIZE / 2,
                        backgroundColor: theme.chartPrimary,
                        opacity: progress.interpolate({
                          inputRange: [0.45, 0.65],
                          outputRange: [0, 1],
                        }),
                        transform: [
                          {
                            translateY: progress.interpolate({
                              inputRange: [0.45, 1],
                              outputRange: [-DOT_DROP_DISTANCE, 0],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.valueRow}>
        <Text
          style={[styles.value, { color: theme.primaryText }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {valueText}
        </Text>
        {latestSpeedSample !== null ? (
          <Text style={[styles.unit, { color: theme.tertiaryText }]}>
            {uiText.data.speedUnit}
          </Text>
        ) : null}
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  plot: {
    height: PLOT_HEIGHT,
    marginBottom: 12,
  },
  barsRow: {
    flexDirection: 'row',
    height: PLOT_HEIGHT,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  /** 区间胶囊柱：上界 P90，下界 P10。 */
  bar: {
    position: 'absolute',
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
  /** 最新速度的黑点：直径与柱宽一致，左右边界对齐柱子。 */
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 15,
    marginLeft: 6,
    fontWeight: '500',
  },
});
