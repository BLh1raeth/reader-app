import { File } from 'expo-file-system';

import type { Book } from '../library/library-types';
import type { ReaderEpubSource } from './reader-types';

/**
 * Only a small URI descriptor crosses Native -> DOM. Expo FileSystem's File
 * implements Blob inside the DOM, so foliate can resolve archive resources on
 * demand without creating a full-book base64 prop or JavaScript string.
 */
export async function createReaderEpubSource(book: Book): Promise<ReaderEpubSource> {
  const file = new File(book.fileUri);
  if (!file.exists) throw new Error('这本书的 EPUB 文件已不存在。');
  return {
    sessionId: `${book.id}:${Date.now()}`,
    fileUri: book.fileUri,
    fileName: `${book.id}.epub`,
    byteLength: file.size,
    sourceKind: 'native-file-blob',
  };
}
