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

function sourceFromCache(book: Book, cached: RecentBookCache): ReaderEpubSource {
  return {
    sessionId: `${book.id}:${Date.now()}`,
    fileName: `${book.id}.epub`,
    byteLength: cached.byteLength,
    base64: cached.base64,
    sourceKind: 'memory-cache',
    sourceReadMs: 0,
  };
}

/**
 * Expo DOM cannot read our app-private FileSystem URI without exposing native
 * modules to EPUB content. This is the deliberately small, one-way bridge:
 * native reads once, DOM turns it into a File, then ReaderScreen drops its
 * prop copy after the DOM engine reports ready. One modest EPUB is retained
 * in-memory for a short time so closing and reopening the same book does not
 * repeat disk read + base64 bridge work.
 */
export async function createReaderEpubSource(book: Book): Promise<ReaderEpubSource> {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const file = new File(book.fileUri);
  if (!file.exists) throw new Error('这本书的 EPUB 文件已不存在。');

  const cached = recentBookCache;
  if (
    cached
    && cached.fileUri === book.fileUri
    && cached.byteLength === file.size
    && Date.now() - cached.cachedAt < RECENT_BOOK_TTL_MS
  ) {
    return sourceFromCache(book, cached);
  }

  const base64 = await file.base64();
  if (file.size <= RECENT_BOOK_MAX_BYTES) {
    recentBookCache = { fileUri: book.fileUri, byteLength: file.size, base64, cachedAt: Date.now() };
  } else if (recentBookCache?.fileUri === book.fileUri) {
    recentBookCache = null;
  }
  return {
    sessionId: `${book.id}:${Date.now()}`,
    fileName: `${book.id}.epub`,
    byteLength: file.size,
    base64,
    sourceKind: 'file-read',
    sourceReadMs: Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt),
  };
}
