import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '../../../design-system/tokens';
import { reorderLayoutTransition } from './library-shared';
import { styles } from './library-styles';

export function ReorderableBook({
  bookId,
  content,
  displayMode,
  index,
  onMove,
  onReorder,
  totalBooks,
  width,
}: {
  bookId: string;
  content: ReactNode;
  displayMode: 'grid' | 'list';
  index: number;
  onMove: (bookId: string, targetIndex: number) => void;
  onReorder: () => void;
  totalBooks: number;
  width: number;
}) {
  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const isDragging = useSharedValue(0);
  const currentIndex = useSharedValue(index);
  const dragStartIndex = useSharedValue(index);
  const lastTargetIndex = useSharedValue(index);
  const lastReorderTimestamp = useSharedValue(0);
  const layoutOffsetX = useSharedValue(0);
  const layoutOffsetY = useSharedValue(0);
  const [dragging, setDragging] = useState(false);
  const [layoutAnimationsEnabled, setLayoutAnimationsEnabled] = useState(false);
  const gridRowStride = width / tokens.cover.gridAspectRatio + 72 + tokens.spacing.gridRow;
  const gridColumnStride = width + tokens.spacing.grid;
  const listRowStride = tokens.cover.listWidth / tokens.cover.gridAspectRatio + tokens.spacing.listRowVertical * 2;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLayoutAnimationsEnabled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const previousIndex = currentIndex.get();

    if (isDragging.get() > 0 && previousIndex !== index) {
      const horizontalShift = displayMode === 'grid'
        ? (index % 2 - previousIndex % 2) * gridColumnStride
        : 0;
      const verticalShift = displayMode === 'grid'
        ? (Math.floor(index / 2) - Math.floor(previousIndex / 2)) * gridRowStride
        : (index - previousIndex) * listRowStride;

      layoutOffsetX.set(layoutOffsetX.get() - horizontalShift);
      layoutOffsetY.set(layoutOffsetY.get() - verticalShift);
      translationX.set(translationX.get() - horizontalShift);
      translationY.set(translationY.get() - verticalShift);
    }

    currentIndex.set(index);
  }, [currentIndex, displayMode, gridColumnStride, gridRowStride, index, isDragging, layoutOffsetX, layoutOffsetY, listRowStride, translationX, translationY]);

  const dragStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translationX.get() },
      { translateY: translationY.get() },
      { scale: interpolate(isDragging.get(), [0, 1], [1, 1.025], Extrapolation.CLAMP) },
    ],
  }));
  const dragContainerStyle = useAnimatedStyle(() => ({
    zIndex: isDragging.get() > 0 ? 10 : 0,
  }));

  const gesture = useMemo(
    () => Gesture.Pan()
      .activateAfterLongPress(180)
      .onBegin(() => {
        isDragging.set(1);
        dragStartIndex.set(currentIndex.get());
        lastTargetIndex.set(currentIndex.get());
        lastReorderTimestamp.set(0);
        layoutOffsetX.set(0);
        layoutOffsetY.set(0);
        runOnJS(setDragging)(true);
      })
      .onUpdate((event) => {
        translationX.set(displayMode === 'grid' ? event.translationX + layoutOffsetX.get() : 0);
        translationY.set(event.translationY + layoutOffsetY.get());

        const rawTargetIndex = displayMode === 'grid'
          ? dragStartIndex.get()
            + Math.round(event.translationY / gridRowStride) * 2
            + Math.round(event.translationX / gridColumnStride)
          : dragStartIndex.get() + Math.round(event.translationY / listRowStride);
        const targetIndex = Math.max(0, Math.min(rawTargetIndex, totalBooks - 1));

        const now = Date.now();
        const canReorder = now - lastReorderTimestamp.get() >= 75;
        if (lastTargetIndex.get() !== targetIndex && canReorder) {
          lastTargetIndex.set(targetIndex);
          lastReorderTimestamp.set(now);
          runOnJS(onReorder)();
          runOnJS(onMove)(bookId, targetIndex);
        }
      })
      .onEnd((event) => {
        const rawTargetIndex = displayMode === 'grid'
          ? dragStartIndex.get()
            + Math.round(event.translationY / gridRowStride) * 2
            + Math.round(event.translationX / gridColumnStride)
          : dragStartIndex.get() + Math.round(event.translationY / listRowStride);
        const targetIndex = Math.max(0, Math.min(rawTargetIndex, totalBooks - 1));
        if (lastTargetIndex.get() !== targetIndex) {
          lastReorderTimestamp.set(Date.now());
          runOnJS(onReorder)();
          runOnJS(onMove)(bookId, targetIndex);
        }
      })
      .onFinalize(() => {
        isDragging.set(withTiming(0, { duration: tokens.animation.pressDuration }));
        translationX.set(withTiming(0, { duration: tokens.animation.layoutDuration }));
        translationY.set(withTiming(0, { duration: tokens.animation.layoutDuration }));
        layoutOffsetX.set(0);
        layoutOffsetY.set(0);
        runOnJS(setDragging)(false);
      }),
    [bookId, currentIndex, displayMode, dragStartIndex, gridColumnStride, gridRowStride, isDragging, lastReorderTimestamp, lastTargetIndex, layoutOffsetX, layoutOffsetY, listRowStride, onMove, onReorder, totalBooks, translationX, translationY],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityLabel="长按后拖动以调整书籍顺序"
        accessible
        collapsable={false}
        layout={dragging || !layoutAnimationsEnabled ? undefined : reorderLayoutTransition}
        style={[displayMode === 'grid' ? { width } : undefined, styles.manualReorderItem, dragContainerStyle]}
      >
        <Animated.View style={dragStyle}>{content}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
