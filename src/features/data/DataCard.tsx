import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useDataTheme } from './dataTheme';

/**
 * Data 页统一卡片容器（2026-09-24 视觉规范）。
 *
 * 白底（深色 #1C1C1E）/ 圆角 28 / 无描边 / 无阴影（靠背景反差区分层级）/
 * 内边距 24。只负责容器，不感知任何指标。
 * 可选 onPress 把整张普通指标卡变成可访问的点击入口；
 * 今日阅读主卡仍自行处理圆环与卡片的两种点击语义。
 */
export function DataCard({
  children,
  style,
  accessible = false,
  accessibilityLabel,
  onPress,
}: {
  children: ReactNode;
  style?: ViewStyle;
  accessible?: boolean;
  accessibilityLabel?: string;
  onPress?: () => void;
}) {
  const theme = useDataTheme();
  const cardStyle = [styles.card, { backgroundColor: theme.cardBackground }, style];
  if (onPress) {
    return (
      <Pressable
        accessible={accessible}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={cardStyle}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      style={cardStyle}
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
