import { PlatformColor, type ColorValue } from 'react-native';

/**
 * Data Tab Core B.2 视觉体系：蓝 / 青 / 灰。
 *
 * B.1“每个指标一个颜色”（蓝紫橙绿红）已收敛：
 * 主 accent = app 蓝，次 accent = 青，点缀 = 系统灰。
 * 全部用系统语义色，深色模式自动适配。
 * 纯展示层，不碰任何统计口径。
 */
export const cardColors = {
  /** 主 accent：概览标题、主数字、阅读时长、节奏卡 */
  primary: PlatformColor('systemBlue'),
  /** 次 accent：阅读速度 */
  secondary: PlatformColor('systemTeal'),
  /**
   * 第三 accent：今日阅读“摘录”行、主卡圆环摘录弧段。
   * 视觉稿要求三行指标三色（蓝 / 青 / 橙），与 B.2 蓝青体系不冲突：仅装饰性点缀。
   */
  tertiary: PlatformColor('systemOrange'),
  /** 第四 accent：阅读节奏卡“累计摘录”数值（视觉稿紫色）。 */
  quaternary: PlatformColor('systemPurple'),
} as const;

/**
 * 概览卡圆环色段：蓝 / 青交替（模仿健康 App 多色环，但收敛到蓝青体系）；
 * 没有阅读的天只显示底层的浅灰整环。
 */
export const overviewRingPalette: ColorValue[] = [
  PlatformColor('systemBlue'),
  PlatformColor('systemTeal'),
];
