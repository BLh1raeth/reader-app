import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { tokens } from '../../design-system/tokens';

/**
 * Data Tab Core B.2：轻量 dashboard 卡片容器。
 *
 * 只负责 background / radius / padding，不感知任何指标。
 * 全站卡片统一圆角（B.2 收敛，不再分 hero / 小卡两档）。
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
  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, style]}
    >
      {children}
    </View>
  );
}

/** Dashboard 统一卡片圆角（与 Excerpts grouped card 同一视觉级别）。 */
export const DATA_CARD_RADIUS = 26;

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colors.groupedCell,
    borderRadius: DATA_CARD_RADIUS,
    padding: 16,
  },
});
