import { bookRepository } from '../library/book-repository';
import type { Book } from '../library/library-types';
import { markReaderOpen } from './reader-open-performance';
import { readingProgressRepository, type ReadingProgress } from './reading-progress-repository';
import { readerPageCacheRepository, type ReaderPageCountCache } from './reader-page-cache-repository';
import { createReaderEpubSource } from './reader-resource-bridge';
import { readerSettingsRepository } from './reader-settings-repository';
import type { ReaderSettings } from './reader-settings';
import type { ReaderEpubSource } from './reader-types';

export type PreloadedReaderData = {
  book: Book;
  source: ReaderEpubSource;
  savedProgress: ReadingProgress | null;
  pageCountCache: ReaderPageCountCache | null;
  savedReaderSettings: ReaderSettings;
};

/**
 * In-flight reader data loads, keyed by book id. `preloadReaderData` starts
 * the expensive work (EPUB file read + ZIP index) the moment a book is tapped,
 * so it runs in parallel with the cover opening animation instead of after it.
 * The reader controller picks the promise up on mount via `loadReaderData`.
 */
const pendingPreloads = new Map<string, Promise<PreloadedReaderData>>();

async function doLoadReaderData(bookId: string): Promise<PreloadedReaderData> {
  const book = await bookRepository.getBookById(bookId);
  if (!book) throw new Error('这本书已不在书库中。');
  markReaderOpen(book.id, 'BOOK_DATA_READY', book.fileSize);
  markReaderOpen(book.id, 'EPUB_FILE_READ_START', book.fileSize);
  markReaderOpen(book.id, 'EPUB_PREPARE_START', book.fileSize);
  const [source, savedProgress, pageCountCache, savedReaderSettings] = await Promise.all([
    createReaderEpubSource(book),
    readingProgressRepository.getByBookId(book.id),
    readerPageCacheRepository.getMostRecent(book.id),
    readerSettingsRepository.get(),
  ]);
  markReaderOpen(book.id, 'EPUB_PREPARE_END', book.fileSize, {
    sourceKind: source.sourceKind,
    sourceReadMs: source.sourceReadMs,
    zipEntryCount: source.entries?.length ?? null,
  });
  markReaderOpen(book.id, 'EPUB_FILE_READ_END', book.fileSize, {
    sourceKind: source.sourceKind,
    sourceReadMs: source.sourceReadMs,
    zipEntryCount: source.entries?.length ?? null,
  });
  console.log('[READER_RESOURCE]', JSON.stringify({
    bookId: book.id,
    byteLength: source.byteLength,
    sourceKind: source.sourceKind,
    sourceReadMs: source.sourceReadMs,
  }));
  console.log('[PROGRESS_READ]', JSON.stringify({
    bookId: book.id,
    savedCfi: savedProgress?.cfi ?? null,
    spineIndex: savedProgress?.spineIndex ?? null,
    percentage: savedProgress?.percentage ?? null,
    updatedAt: savedProgress?.updatedAt ?? null,
  }));
  return { book, source, savedProgress, pageCountCache, savedReaderSettings };
}

/**
 * Fire-and-forget: begin loading a book's reader data now. Safe to call on
 * every tap; repeat calls for the same book are ignored while one is in flight.
 */
export function preloadReaderData(bookId: string): void {
  if (pendingPreloads.has(bookId)) return;
  const promise = doLoadReaderData(bookId);
  pendingPreloads.set(bookId, promise);
  // If nobody ever consumes this (transition cancelled, navigation failed),
  // drop it so a later tap retries fresh instead of reusing a stale failure.
  // Resolved bytes stay in the bounded bookBytesCache, so the work isn't wasted.
  promise.catch(() => {
    if (pendingPreloads.get(bookId) === promise) pendingPreloads.delete(bookId);
  });
}

/**
 * Called by the reader controller on mount. Awaits the in-flight preload when
 * one exists (the tap already started it); otherwise loads immediately, e.g.
 * for deep links that bypass the library screen.
 */
export function loadReaderData(bookId: string): Promise<PreloadedReaderData> {
  const pending = pendingPreloads.get(bookId);
  if (pending) {
    pendingPreloads.delete(bookId);
    return pending;
  }
  return doLoadReaderData(bookId);
}
