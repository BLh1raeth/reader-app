import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '../../../design-system/tokens';
import { BookCoverArt } from '../BookCoverArt';
import type { ReaderOpeningTransition } from './library-shared';
import { styles } from './library-styles';

export function ReaderOpeningTransitionOverlay({
  onFinished,
  transition,
}: {
  onFinished: (transition: ReaderOpeningTransition) => void;
  transition: ReaderOpeningTransition;
}) {
  // This value belongs to one overlay mount only. A new opening never sees
  // the previous cover's completed value or native animated node.
  const progress = useSharedValue(0);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.72, 1], [0, 0.96, 1], Extrapolation.CLAMP),
  }));
  const coverStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.get(), [0, 1], [transition.frame.height, transition.target.height]),
    left: interpolate(progress.get(), [0, 1], [transition.frame.x, transition.target.x]),
    top: interpolate(progress.get(), [0, 1], [transition.frame.y, transition.target.y]),
    width: interpolate(progress.get(), [0, 1], [transition.frame.width, transition.target.width]),
  }));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      progress.set(withTiming(1, {
        duration: 460,
        easing: Easing.inOut(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }, (finished) => {
        if (finished) runOnJS(onFinished)(transition);
      }));
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimation(progress);
    };
  }, [onFinished, progress, transition]);

  return (
    <View pointerEvents="auto" style={[StyleSheet.absoluteFill, styles.readerOpeningTransition]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: transition.backgroundColor, opacity: 0 },
          backdropStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.readerOpeningCover,
          {
            backgroundColor: tokens.coverTones[transition.book.coverTone],
            // The non-animated fallback is deliberately the source rectangle.
            // If the native animated style attaches one frame late, there is
            // still no possible frame where this cover appears at the target.
            height: transition.frame.height,
            left: transition.frame.x,
            top: transition.frame.y,
            width: transition.frame.width,
          },
          coverStyle,
        ]}
      >
        <BookCoverArt
          author={transition.book.author}
          coverTone={transition.book.coverTone}
          coverUri={transition.book.coverUri}
          hasGeneratedCover={transition.book.hasGeneratedCover}
          title={transition.book.title}
        />
      </Animated.View>
    </View>
  );
}
