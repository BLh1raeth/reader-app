import { View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { BookCoverArt } from '../BookCoverArt';
import type { LibraryBook } from './library-shared';
import { styles } from './library-styles';

export function BookCover({
  book,
  width,
  presentation,
}: {
  book: LibraryBook;
  width: number;
  presentation: 'grid' | 'continue' | 'list';
}) {
  const height = width / tokens.cover.gridAspectRatio;
  const shadowStyle = presentation === 'grid'
    ? styles.coverShadowGrid
    : presentation === 'continue'
      ? styles.coverShadowContinue
      : styles.coverShadowList;
  const tightShadowStyle = presentation === 'grid'
    ? styles.coverShadowGridTight
    : presentation === 'continue'
      ? styles.coverShadowContinueTight
      : styles.coverShadowListTight;
  const coverBackground = tokens.coverTones[book.coverTone];

  return (
    <View
      accessibilityLabel={`${book.title}的${book.hasGeneratedCover ? '默认' : '模拟'}封面`}
      style={[styles.coverContainer, { width, height }]}
    >
      <View style={[styles.coverShadow, shadowStyle, { backgroundColor: coverBackground }]}>
        <View style={[styles.coverShadowTight, tightShadowStyle, { backgroundColor: coverBackground }]}>
          <BookCoverArt
            author={book.author}
            coverTone={book.coverTone}
            coverUri={book.coverUri}
            hasGeneratedCover={book.hasGeneratedCover}
            title={book.title}
          />
        </View>
      </View>
    </View>
  );
}
