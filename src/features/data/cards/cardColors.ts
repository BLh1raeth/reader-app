import { PlatformColor, type ColorValue } from 'react-native';

/**
 * Data Tab 视觉配色：模仿 Apple Health，每类指标一个鲜艳 accent。
 *
 * 全部用系统语义色（随浅色/深色模式自动适配），纯展示层，不碰任何统计口径。
 */
export const cardColors = {
  /** 今日阅读 / 最近 7 天：健康蓝 */
  today: PlatformColor('systemBlue'),
  last7Days: PlatformColor('systemBlue'),
  /** 连续阅读：活力橙 */
  streak: PlatformColor('systemOrange'),
  /** 阅读速度：紫 */
  speed: PlatformColor('systemPurple'),
  /** 阅读天数：绿 */
  days: PlatformColor('systemGreen'),
  /** 摘录：粉 */
  excerpts: PlatformColor('systemPink'),
} as const;

/**
 * “阅读活跃”环的色段调色板：最近 7 天每天一段，按顺序循环取色，
 * 模仿健康 App 睡眠评分的多色分段圆环。
 */
export const activityRingPalette: ColorValue[] = [
  PlatformColor('systemBlue'),
  PlatformColor('systemTeal'),
  PlatformColor('systemGreen'),
  PlatformColor('systemOrange'),
  PlatformColor('systemPink'),
  PlatformColor('systemPurple'),
  PlatformColor('systemRed'),
];
