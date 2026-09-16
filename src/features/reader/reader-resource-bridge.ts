import { File } from 'expo-file-system';

import type { Book } from '../library/library-types';
import type { ReaderEpubSource } from './reader-types';

const RECENT_BOOK_MAX_BYTES = 12 * 1024 * 1024;
const RECENT_BOOK_TTL_MS = 10 * 60 * 1000;

type RecentBookCache = {
  fileUri: string;
  byteLength: number;
  base64: string;
  cachedAt: number;
};

let recentBookCache: RecentBookCache | null = null;

/**
 * Expo DOM runs with its web runtime, where expo-file-system is not available.
 * Keep that compatibility boundary here until a native-free direct resource
 * API is available. Small, recently opened books avoid a second file read.
 */
export async function createReaderEpubSource(book: Book): Promise<ReaderEpubSource> {
  const file = new File(book.fileUri);
  if (!file.exists) throw new Error('这本书的 EPUB 文件已不存在。');
  const startedAt = Date.now();
  const cachedBook = recentBookCache;
  const canUseCache = cachedBook
    && cachedBook.fileUri === book.fileUri
    && cachedBook.byteLength === file.size
    && Date.now() - cachedBook.cachedAt < RECENT_BOOK_TTL_MS;
  if (canUseCache && cachedBook) {
    return {
      sessionId: `${book.id}:${Date.now()}`,
      fileName: `${book.id}.epub`,
      byteLength: file.size,
      base64: cachedBook.base64,
      sourceKind: 'memory-cache',
      sourceReadMs: Date.now() - startedAt,
    };
  }
  const base64 = await file.base64();
  if (file.size <= RECENT_BOOK_MAX_BYTES) {
    recentBookCache = { fileUri: book.fileUri, byteLength: file.size, base64, cachedAt: Date.now() };
  } else {
    recentBookCache = null;
  }
  return {
    sessionId: `${book.id}:${Date.now()}`,
    fileName: `${book.id}.epub`,
    byteLength: file.size,
    base64,
    sourceKind: 'file-read',
    sourceReadMs: Date.now() - startedAt,
  };
}
