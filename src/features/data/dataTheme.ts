import { useColorScheme } from 'react-native';

/**
 * Data 页视觉主题（Data Core B.6：黑白极简视觉统一）。
 *
 * 浅色 = B.6 规范固定值：#FAFAFC 页面底 / #FFFFFF 卡片 / #111111 主文字 /
 * #636366 次要 / #8E8E93 辅助 / #AEAEB2 弱化 /
 * #242424 主图表 / #626262 次图表 / #A1A1A6 浅图表 / #E5E5EA 无数据 /
 * #E9E9EC 分割线。整页只出现白、黑、灰。
 *
 * 深色模式本轮不重构：仅保留可用的灰阶映射（不崩、能看），
 * 等 B.6 浅色视觉稳定后再单独处理。
 *
 * 纯展示层：只提供颜色，不碰任何统计口径。
 * 仅 Data 页面使用；不覆盖书库 / 摘录 / Tab Bar 的系统颜色。
 */
export type DataTheme = {
  pageBackground: string;
  cardBackground: string;
  /** 主文字 #111111 */
  primaryText: string;
  /** 次要文字 #636366 */
  secondaryText: string;
  /** 辅助文字 #8E8E93 */
  tertiaryText: string;
  /** 弱化文字 #AEAEB2 */
  faintText: string;
  /** 主图表 #242424 */
  chartPrimary: string;
  /** 次图表 #626262 */
  chartSecondary: string;
  /** 浅图表 #A1A1A6 */
  chartLight: string;
  /** 无数据图表 #E5E5EA */
  chartEmpty: string;
  /** 分割线 #E9E9EC */
  divider: string;
  /** 三同心圆环轨道底色（圆环实现禁止改动，token 保留原值） */
  ringTrack: string;
};

const lightTheme: DataTheme = {
  pageBackground: '#FAFAFC',
  cardBackground: '#FFFFFF',
  primaryText: '#111111',
  secondaryText: '#636366',
  tertiaryText: '#8E8E93',
  faintText: '#AEAEB2',
  chartPrimary: '#242424',
  chartSecondary: '#626262',
  chartLight: '#A1A1A6',
  chartEmpty: '#E5E5EA',
  divider: '#E9E9EC',
  ringTrack: '#EAEAEA',
};

/** 深色：本轮不重构，仅保证可用（灰阶映射）。 */
const darkTheme: DataTheme = {
  pageBackground: '#000000',
  cardBackground: '#1C1C1E',
  primaryText: '#FFFFFF',
  secondaryText: '#8E8E93',
  tertiaryText: '#8E8E93',
  faintText: '#636366',
  chartPrimary: '#E5E5EA',
  chartSecondary: '#A1A1A6',
  chartLight: '#636366',
  chartEmpty: '#2E2E33',
  divider: '#2E2E33',
  ringTrack: '#2E2E33',
};

export function useDataTheme(): DataTheme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}
