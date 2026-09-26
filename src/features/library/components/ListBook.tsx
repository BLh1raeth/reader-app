import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { BookCover } from './BookCover';
import { BookTitleMenu } from './BookTitleMenu';
import { SelectionIndicator } from './SelectionIndicator';
import { readingStateLabel } from './library-shared';
import type { BookMenuHandlers, LibraryBook, ReaderOpeningFrame } from './library-shared';
import { styles } from './library-styles';

export function ListBook({ book, manualOrdering, onOpenReader, opening, titleMenu, selected, selectionMode }: { book: LibraryBook; manualOrdering: boolean; onOpenReader?: (frame: ReaderOpeningFrame) => void; opening: boolean; titleMenu?: BookMenuHandlers; selected: boolean; selectionMode: boolean }) {
  const coverRef = useRef<View>(null);
  return (
    <View style={styles.listBook}>
      <View style={[styles.listCoverWrap, opening ? styles.openingSourceHidden : null]}>
        <Pressable
          accessibilityLabel={`打开 ${book.title}`}
          accessibilityRole="button"
          disabled={!onOpenReader}
          onPress={() => coverRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
            onOpenReader?.({ height: measuredHeight, width: measuredWidth, x, y });
          })}
        >
          <View collapsable={false} ref={coverRef}>
            <BookCover book={book} width={tokens.cover.listWidth} presentation="list" />
          </View>
        </Pressable>
        {selected ? <SelectionIndicator selected /> : null}
      </View>
      <View style={styles.listMetadata}>
        <BookTitleMenu book={book} handlers={titleMenu}>
          <View style={styles.listMenuTrigger}>
            <Text selectable numberOfLines={manualOrdering ? 1 : 2} style={styles.listTitle}>{book.title}</Text>
            {book.author ? <Text selectable numberOfLines={1} style={styles.author}>{book.author}</Text> : null}
            {!selectionMode ? <Text selectable style={styles.listState}>{readingStateLabel(book)}</Text> : null}
          </View>
        </BookTitleMenu>
      </View>
    </View>
  );
}
