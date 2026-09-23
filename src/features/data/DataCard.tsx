import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { tokens } from '../../design-system/tokens';

/**
 * Data Tab Core B.1：轻量 dashboard 卡片容器。
 *
 * 只负责 background / radius / padding / minHeight，不感知任何指标。
 * 卡片暂时全部不可点击（详情页未实现）：这里不包 Pressable、不加 chevron。
 */
export function DataCard({
  children,
  minHeight,
  style,
  accessible = false,
  accessibilityLabel,
}: {
  children: ReactNode;
  /** 同一 row 的卡片用 stretch 等高；不同 section 可给不同 minHeight 形成层级。 */
  minHeight?: number;
  style?: ViewStyle;
  accessible?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, minHeight !== undefined ? { minHeight } : null, style]}
    >
      {children}
    </View>
  );
}

/** Dashboard 统一卡片圆角（与 Excerpts grouped card 同一视觉级别）。 */
export const DATA_CARD_RADIUS = 26;
/** Hero 略大，但不与小卡差异巨大。 */
export const DATA_HERO_RADIUS = 28;

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colors.groupedCell,
    borderRadius: DATA_CARD_RADIUS,
    padding: 16,
  },
});
