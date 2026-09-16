import { File } from 'expo-file-system';

import type { Book } from '../library/library-types';
import type { ReaderEpubSource } from './reader-types';

/**
 * Expo DOM cannot read our app-private FileSystem URI without exposing native
 * modules to EPUB content. This is the deliberately small, one-way bridge:
 * native reads once, DOM turns it into a File, then ReaderScreen drops this
 * string after the DOM engine reports ready.
 */
export async function createReaderEpubSource(book: Book): Promise<ReaderEpubSource> {
  const file = new File(book.fileUri);
  if (!file.exists) throw new Error('这本书的 EPUB 文件已不存在。');

  const base64 = await file.base64();
  return {
    sessionId: `${book.id}:${Date.now()}`,
    fileName: `${book.id}.epub`,
    byteLength: file.size,
    base64,
  };
}
