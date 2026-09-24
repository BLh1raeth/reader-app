import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useDataTheme } from './dataTheme';

/**
 * Data 页统一卡片容器（2026-09-24 视觉规范）。
 *
 * 白底（深色 #1C1C1E）/ 圆角 28 / 无描边 / 无阴影（靠背景反差区分层级）/
 * 内边距 24。只负责容器，不感知任何指标。
 * 卡片暂时全部不可点击（详情页未实现）：这里不包 Pressable、不加 chevron。
 */
export function DataCard({
  children,
  style,
  accessible = false,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: ViewStyle;
  accessible?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useDataTheme();
  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, { backgroundColor: theme.cardBackground }, style]}
    >
      {children}
    </View>
  );
}

/** Data 页统一卡片圆角。 */
export const DATA_CARD_RADIUS = 28;

const styles = StyleSheet.create({
  card: {
    borderRadius: DATA_CARD_RADIUS,
    padding: 24,
  },
});
