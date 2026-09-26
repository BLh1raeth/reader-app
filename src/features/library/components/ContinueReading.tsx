import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '../../../design-system/tokens';
import { BookCover } from './BookCover';
import { ProgressBar } from './ProgressBar';
import { displayProgress } from './library-shared';
import type { LibraryBook, ReaderOpeningFrame } from './library-shared';
import { styles } from './library-styles';

export function ContinueReading({ book, onOpenReader, opening, selectionMode }: { book: LibraryBook; onOpenReader: (frame: ReaderOpeningFrame) => void; opening: boolean; selectionMode: boolean }) {
  const selectionProgress = useSharedValue(1);
  const coverRef = useRef<View>(null);

  useEffect(() => {
    selectionProgress.set(withTiming(selectionMode ? 0 : 1, { duration: 220 }));
  }, [selectionMode, selectionProgress]);

  const selectionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selectionProgress.get(), [0, 1], [0.48, 1], Extrapolation.CLAMP),
  }));

  const bookPreview = (
    <View style={styles.continueBook}>
      <View collapsable={false} ref={coverRef} style={opening ? styles.openingSourceHidden : null}>
        <BookCover book={book} width={tokens.cover.continueWidth} presentation="continue" />
      </View>
      <View style={styles.continueMetadata}>
        <Text selectable numberOfLines={2} style={styles.continueTitle}>{book.title}</Text>
        {book.author ? <Text selectable numberOfLines={1} style={styles.author}>{book.author}</Text> : null}
        <Text selectable style={styles.progressText}>已读 {displayProgress(book)}%</Text>
        <ProgressBar progress={displayProgress(book) ?? 0} />
      </View>
    </View>
  );

  return (
    <View style={styles.continueSection}>
      <Text selectable style={styles.sectionTitle}>继续阅读</Text>
      <Animated.View pointerEvents={selectionMode ? 'none' : 'auto'} style={selectionStyle}>
        {selectionMode ? bookPreview : (
          <Pressable
            accessibilityLabel={`继续阅读，${book.title}`}
            accessibilityRole="button"
            onPress={() => coverRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
              onOpenReader({ height: measuredHeight, width: measuredWidth, x, y });
            })}
          >
            {bookPreview}
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}
