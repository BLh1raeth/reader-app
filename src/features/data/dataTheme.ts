import { useColorScheme } from 'react-native';

/**
 * Data 页视觉主题（用户 2026-09-24 视觉规范 + 深色模式映射）。
 *
 * 浅色 = 规范里的精确 hex（#F3F2F7 底 / #FFFFFF 卡 / #111111 主文字 / #4A8CFF 蓝 /
 * #57C7D4 青 / #F39A3E 橙 / #C554F2 紫）；
 * 深色 = 我映射的等效体系：纯黑底 / #1C1C1E 卡 / 白字主文字，
 * 强调色保持高饱和、只在深色下把蓝色略提亮以保证对比度。
 *
 * 纯展示层：只提供颜色，不碰任何统计口径。
 */
export type DataTheme = {
  pageBackground: string;
  cardBackground: string;
  primaryText: string;
  secondaryText: string;
  divider: string;
  /** 圆环底环 / 图表轨道底色 */
  ringTrack: string;
  /** 浅灰圆点 / 辅助线 */
  rail: string;
  /** 主蓝：标题、今日阅读、时长 */
  blue: string;
  /** 时长指标点 / 圆环时长弧段 */
  durationBlue: string;
  /** 非今天柱子的浅蓝 */
  barLightBlue: string;
  /** 青：速度、字数 */
  teal: string;
  /** 橙：摘录 */
  orange: string;
  /** 紫：累计摘录 */
  purple: string;
};

const lightTheme: DataTheme = {
  pageBackground: '#F3F2F7',
  cardBackground: '#FFFFFF',
  primaryText: '#111111',
  secondaryText: '#8E8E93',
  divider: '#E9E9EE',
  ringTrack: '#EAEAEA',
  rail: '#E5E5EA',
  blue: '#4A8CFF',
  durationBlue: '#3F83F8',
  barLightBlue: '#8EC5FF',
  teal: '#57C7D4',
  orange: '#F39A3E',
  purple: '#C554F2',
};

const darkTheme: DataTheme = {
  pageBackground: '#000000',
  cardBackground: '#1C1C1E',
  primaryText: '#FFFFFF',
  secondaryText: '#8E8E93',
  divider: '#2E2E33',
  ringTrack: '#2E2E33',
  rail: '#48484A',
  blue: '#5E9BFF',
  durationBlue: '#5E9BFF',
  barLightBlue: '#8EC5FF',
  teal: '#57C7D4',
  orange: '#F39A3E',
  purple: '#C554F2',
};

export function useDataTheme(): DataTheme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}
