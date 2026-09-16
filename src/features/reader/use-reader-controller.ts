import { AppState } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

import { bookRepository } from '../library/book-repository';
import type { Book } from '../library/library-types';
import { readingProgressRepository, type ReadingProgress } from './reading-progress-repository';
import { createReaderEpubSource } from './reader-resource-bridge';
import type { ReaderEpubSource, ReaderLocation } from './reader-types';

export type ReaderControllerState =
  | { kind: 'loading'; message: string }
  | { kind: 'opening'; book: Book; source: ReaderEpubSource; restoreCfi: string | null }
  | { kind: 'ready'; book: Book; restoreCfi: string | null }
  | { kind: 'error'; message: string };

function toProgress(bookId: string, location: ReaderLocation): ReadingProgress {
  return {
    bookId,
    cfi: location.cfi,
    spineIndex: location.spineIndex,
    percentage: location.percentage,
    currentPage: location.currentPage,
    totalPages: location.totalPages,
    updatedAt: new Date().toISOString(),
  };
}

/** Native half of Reader Core. DOM never reads SQLite or FileSystem paths. */
export function useReaderController(bookId: string | undefined) {
  const [state, setState] = useState<ReaderControllerState>({ kind: 'loading', message: '正在打开图书' });
  const [currentLocation, setCurrentLocation] = useState<ReaderLocation | null>(null);
  const latestLocationRef = useRef<ReaderLocation | null>(null);
  const currentBookRef = useRef<Book | null>(null);
  const engineReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeQueueRef = useRef(Promise.resolve());

  const flushLocation = useCallback(async () => {
    const book = currentBookRef.current;
    const location = latestLocationRef.current;
    if (!engineReadyRef.current || !book || !location) return;
    const progress = toProgress(book.id, location);
    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await readingProgressRepository.upsert(progress);
        await bookRepository.recordReading(book.id, progress.percentage);
      });
    await writeQueueRef.current;
  }, []);

  const scheduleLocationFlush = useCallback(() => {
    if (!engineReadyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushLocation().catch(() => undefined);
    }, 700);
  }, [flushLocation]);

  const onLocation = useCallback(async (location: ReaderLocation) => {
    latestLocationRef.current = location;
    setCurrentLocation(location);
    scheduleLocationFlush();
  }, [scheduleLocationFlush]);

  const onEngineReady = useCallback(async (location: ReaderLocation) => {
    latestLocationRef.current = location;
    setCurrentLocation(location);
    engineReadyRef.current = true;
    // Drop the native bridge string immediately; foliate now owns its File/Blob.
    setState((current) => current.kind === 'opening'
      ? { kind: 'ready', book: current.book, restoreCfi: current.restoreCfi }
      : current);
    await flushLocation().catch(() => undefined);
  }, [flushLocation]);

  const onEngineError = useCallback(async (message: string) => {
    engineReadyRef.current = false;
    latestLocationRef.current = null;
    setCurrentLocation(null);
    setState({ kind: 'error', message });
  }, []);

  useEffect(() => {
    let active = true;
    engineReadyRef.current = false;
    latestLocationRef.current = null;
    setCurrentLocation(null);
    currentBookRef.current = null;
    if (!bookId) {
      setState({ kind: 'error', message: '找不到这本书。' });
      return undefined;
    }
    setState({ kind: 'loading', message: '正在查询图书' });
    void (async () => {
      try {
        const book = await bookRepository.getBookById(bookId);
        if (!book) throw new Error('这本书已不在书库中。');
        currentBookRef.current = book;
        if (!active) return;
        setState({ kind: 'loading', message: '正在读取 EPUB' });
        const [source, savedProgress] = await Promise.all([
          createReaderEpubSource(book),
          readingProgressRepository.getByBookId(book.id),
        ]);
        if (!active) return;
        setState({ kind: 'opening', book, source, restoreCfi: savedProgress?.cfi ?? null });
      } catch (error) {
        if (!active) return;
        setState({ kind: 'error', message: error instanceof Error ? error.message : '无法打开这本书。' });
      }
    })();
    return () => {
      active = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void flushLocation().catch(() => undefined);
    };
  }, [bookId, flushLocation]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        void flushLocation().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [flushLocation]);

  return { state, currentLocation, flushLocation, onLocation, onEngineReady, onEngineError };
}
