import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';

import { styles } from './library-styles';

export function SelectionGlass({
  children,
  colorScheme,
  style,
  tintColor,
}: {
  children: ReactNode;
  colorScheme?: 'auto' | 'light' | 'dark';
  style: StyleProp<ViewStyle>;
  tintColor?: string;
}) {
  if (isGlassEffectAPIAvailable()) {
    return (
      <GlassView colorScheme={colorScheme} glassEffectStyle="regular" isInteractive style={style} tintColor={tintColor}>
        {children}
      </GlassView>
    );
  }

  return <View style={[styles.selectionGlassFallback, style]}>{children}</View>;
}
