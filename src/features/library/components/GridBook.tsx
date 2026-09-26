import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { BookCover } from './BookCover';
import { BookTitleMenu } from './BookTitleMenu';
import { SelectionIndicator } from './SelectionIndicator';
import { readingStateLabel } from './library-shared';
import type { BookMenuHandlers, LibraryBook, ReaderOpeningFrame } from './library-shared';
import { styles } from './library-styles';

export function GridBook({ book, manualOrdering, onOpenReader, opening, titleMenu, width, selected, selectionMode }: { book: LibraryBook; manualOrdering: boolean; onOpenReader?: (frame: ReaderOpeningFrame) => void; opening: boolean; titleMenu?: BookMenuHandlers; width: number; selected: boolean; selectionMode: boolean }) {
  const coverRef = useRef<View>(null);
  return (
    <View style={[styles.gridBook, { width }]}>
      <View style={[styles.coverWrap, opening ? styles.openingSourceHidden : null]}>
        <Pressable
          accessibilityLabel={`打开 ${book.title}`}
          accessibilityRole="button"
          disabled={!onOpenReader}
          onPress={() => coverRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
            onOpenReader?.({ height: measuredHeight, width: measuredWidth, x, y });
          })}
        >
          <View collapsable={false} ref={coverRef}>
            <BookCover book={book} width={width} presentation="grid" />
          </View>
        </Pressable>
        {selected ? <View pointerEvents="none" style={styles.coverSelectionCenter}><SelectionIndicator selected /></View> : null}
      </View>
      {!selectionMode ? (
        <BookTitleMenu book={book} handlers={titleMenu}>
          <View style={styles.gridMenuTrigger}>
            <Text selectable numberOfLines={manualOrdering ? 1 : 2} style={styles.gridTitle}>{book.title}</Text>
            <Text selectable style={styles.gridState}>{readingStateLabel(book)}</Text>
          </View>
        </BookTitleMenu>
      ) : null}
    </View>
  );
}
