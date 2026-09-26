import { Pressable, Text, View, useColorScheme } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { IMPORT_RING_CIRCUMFERENCE, IMPORT_RING_RADIUS } from './library-shared';
import { styles } from './library-styles';

export function LibraryMenuTrigger({ selectionProgress, importProgress }: { selectionProgress: SharedValue<number>; importProgress: number | null }) {
  const colorScheme = useColorScheme();
  const glyphReturnStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selectionProgress.get(), [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(selectionProgress.get(), [0, 1], [1, 0.85], Extrapolation.CLAMP) }],
  }));
  const importing = importProgress !== null;
  const trigger = (
    <Pressable
      accessibilityLabel="书库菜单"
      accessibilityRole="button"
      accessibilityState={{ disabled: importing }}
      disabled={importing}
      style={[styles.menuTriggerContent, importing && styles.menuTriggerDisabled]}
    >
      <Animated.Text style={[styles.menuTriggerGlyph, glyphReturnStyle]}>•••</Animated.Text>
    </Pressable>
  );

  const surface = isGlassEffectAPIAvailable() ? (
    <GlassView glassEffectStyle="regular" isInteractive style={styles.menuGlass}>
      {trigger}
    </GlassView>
  ) : (
    <View style={styles.menuTriggerFallback}>{trigger}</View>
  );

  return (
    // pointerEvents none while importing so the menu can't be opened mid-import.
    <View style={styles.menuTriggerWrap} pointerEvents={importing ? 'none' : 'auto'}>
      {surface}
      {importing ? (
        <Svg style={styles.menuProgressRing} viewBox="0 0 44 44">
          <Circle
            cx={22}
            cy={22}
            r={IMPORT_RING_RADIUS}
            fill="none"
            stroke={colorScheme === 'dark' ? '#0A84FF' : '#007AFF'}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${IMPORT_RING_CIRCUMFERENCE * Math.min(1, Math.max(0, importProgress))} ${IMPORT_RING_CIRCUMFERENCE}`}
            transform="rotate(-90 22 22)"
          />
        </Svg>
      ) : null}
    </View>
  );
}
