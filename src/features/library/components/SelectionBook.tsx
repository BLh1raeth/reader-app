import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { layoutTransition, selectionTransitionDuration } from './library-shared';
import type { LibraryBook } from './library-shared';
import { SelectionIndicator } from './SelectionIndicator';
import { styles } from './library-styles';

export function SelectionBook({
  active,
  book,
  content,
  displayMode,
  exiting,
  modeProgress,
  onToggle,
  selected,
  width,
}: {
  active: boolean;
  book: LibraryBook;
  content: ReactNode;
  displayMode: 'grid' | 'list';
  exiting: boolean;
  modeProgress: SharedValue<number>;
  onToggle: () => void;
  selected: boolean;
  width: number;
}) {
  const selectionProgress = useSharedValue(1);

  useEffect(() => {
    const target = active ? (exiting || selected ? 1 : 0) : 1;
    selectionProgress.set(withTiming(target, { duration: selectionTransitionDuration }));
  }, [active, exiting, selected, selectionProgress]);

  const selectionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selectionProgress.get(), [0, 1], [0.48, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(selectionProgress.get(), [0, 1], [0.94, 1], Extrapolation.CLAMP) }],
  }));
  const listContentStyle = useAnimatedStyle(() => ({
    transform: [{
      translateX: displayMode === 'list'
        ? interpolate(modeProgress.get(), [0, 1], [0, 22], Extrapolation.CLAMP)
        : 0,
    }],
  }));
  const listIndicatorStyle = useAnimatedStyle(() => ({
    opacity: displayMode === 'list' ? modeProgress.get() : 0,
    transform: [{
      scale: displayMode === 'list'
        ? interpolate(modeProgress.get(), [0, 1], [0.72, 1], Extrapolation.CLAMP)
        : 0,
    }],
  }));

  return (
    <Animated.View layout={layoutTransition} style={[displayMode === 'grid' ? { width } : undefined, selectionStyle]}>
      <Animated.View style={[styles.selectionContent, listContentStyle]}>{content}</Animated.View>
      {active ? (
        <Pressable
          accessibilityLabel={`${book.title}，${selected ? '已选择' : '未选择'}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          disabled={exiting}
          onPress={onToggle}
          style={displayMode === 'grid' ? styles.selectionGridItem : styles.selectionRow}
        >
          {displayMode === 'list' ? (
            <Animated.View pointerEvents="none" style={[styles.selectionListIndicator, listIndicatorStyle]}>
              <SelectionIndicator compact selected={selected} />
            </Animated.View>
          ) : null}
        </Pressable>
      ) : null}
    </Animated.View>
  );
}
