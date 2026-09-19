import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../design-system/tokens';
import type { CoverTone } from './library-types';
import { uiText } from '../../localization';

type Props = {
  author: string | null;
  coverTone: CoverTone;
  coverUri: string | null;
  hasGeneratedCover: boolean;
  title: string;
};

/** The shared, shadow-free cover artwork used by Library and Reader opening. */
export function BookCoverArt({ author, coverTone, coverUri, hasGeneratedCover, title }: Props) {
  const [didFailToLoadCover, setDidFailToLoadCover] = useState(false);
  const isLightTone = coverTone === 'paper' || coverTone === 'mist';
  const coverBackground = tokens.coverTones[coverTone];

  if (coverUri && !didFailToLoadCover) {
    return (
      <Image
        accessibilityLabel={uiText.library.bookCover(title)}
        onError={() => setDidFailToLoadCover(true)}
        resizeMode="cover"
        source={{ uri: coverUri }}
        style={styles.coverImage}
      />
    );
  }

  return (
    <View style={[styles.cover, { backgroundColor: coverBackground }]}>
      <View style={styles.coverAccent} />
      <Text numberOfLines={3} style={[styles.coverTitle, isLightTone ? styles.coverTitleDark : styles.coverTitleLight]}>{title}</Text>
      {author ? (
        <Text numberOfLines={1} style={[styles.coverAuthor, isLightTone ? styles.coverTitleDark : styles.coverTitleLight]}>{author}</Text>
      ) : <View />}
      {hasGeneratedCover ? <Text style={[styles.coverGeneratedLabel, isLightTone ? styles.coverTitleDark : styles.coverTitleLight]}>{uiText.library.reading}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    borderCurve: 'continuous',
    borderRadius: tokens.radius.cover,
    flex: 1,
    justifyContent: 'space-between',
    overflow: 'hidden',
    padding: tokens.spacing.coverInset,
  },
  coverAccent: { backgroundColor: 'rgba(255,255,255,0.42)', borderRadius: 1, height: 1, width: 18 },
  coverAuthor: { fontSize: 10, fontWeight: '500', opacity: 0.72 },
  coverGeneratedLabel: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  coverImage: {
    borderCurve: 'continuous',
    borderRadius: tokens.radius.cover,
    height: '100%',
    width: '100%',
  },
  coverTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.15, lineHeight: 19 },
  coverTitleDark: { color: '#2C2C2E' },
  coverTitleLight: { color: '#FFFFFF' },
});
