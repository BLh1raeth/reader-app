import { AppState } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

import { bookRepository } from '../library/book-repository';
import type { Book } from '../library/library-types';
import { readingProgressRepository, type ReadingProgress } from './reading-progress-repository';
import { createReaderEpubSource } from './reader-resource-bridge';
import type { ReaderEngineDiagnostic, ReaderEpubSource, ReaderLocation, ReaderRestoreState } from './reader-types';

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
    // Persist a location fraction; only the Library view formats it as a
    // rounded percent string.
    percentage: location.percentage / 100,
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
  const restoreStateRef = useRef<ReaderRestoreState>('opening');
  const hasActiveLocationChangeRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeQueueRef = useRef(Promise.resolve());

  const flushLocation = useCallback(async () => {
    const book = currentBookRef.current;
    const location = latestLocationRef.current;
    if (!engineReadyRef.current || restoreStateRef.current !== 'active' || !hasActiveLocationChangeRef.current || !book || !location) return;
    const progress = toProgress(book.id, location);
    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        console.log('[PROGRESS_WRITE]', JSON.stringify({
          bookId: book.id,
          cfi: progress.cfi,
          restoreState: restoreStateRef.current,
          percentage: progress.percentage,
        }));
        await readingProgressRepository.upsert(progress);
        await bookRepository.recordReading(book.id);
        const persisted = await readingProgressRepository.readRawForDebug(book.id);
        console.log('[PROGRESS_WRITE]', JSON.stringify({
          bookId: book.id,
          cfi: persisted?.cfi ?? null,
          restoreState: restoreStateRef.current,
          percentage: persisted?.percentage ?? null,
          spineIndex: persisted?.spine_index ?? null,
          updatedAt: persisted?.updated_at ?? null,
          verified: true,
        }));
      });
    await writeQueueRef.current;
  }, []);

  const scheduleLocationFlush = useCallback(() => {
    if (!engineReadyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushLocation().catch(() => undefined);
    }, 300);
  }, [flushLocation]);

  const activateEngine = useCallback((location: ReaderLocation, source: 'dom-location' | 'engine-ready') => {
    if (restoreStateRef.current === 'active' && engineReadyRef.current) return;
    restoreStateRef.current = 'active';
    latestLocationRef.current = location;
    setCurrentLocation(location);
    engineReadyRef.current = true;
    // The DOM bridge delivers its first `active` relocation before its
    // `open()` promise callback can always reach Native. Treat that event as
    // the authoritative ready boundary, but do not make it writable.
    setState((current) => current.kind === 'opening'
      ? { kind: 'ready', book: current.book, restoreCfi: current.restoreCfi }
      : current);
    console.log('[ENGINE_ACTIVE]', JSON.stringify({ bookId: currentBookRef.current?.id ?? null, cfi: location.cfi, source }));
  }, []);

  const onLocation = useCallback(async (location: ReaderLocation, domRestoreState: ReaderRestoreState) => {
    const nativeRestoreState = restoreStateRef.current;
    const isFirstActiveLocation = domRestoreState === 'active' && nativeRestoreState !== 'active';
    console.log('[LOCATION_CHANGED]', JSON.stringify({
      cfi: location.cfi,
      restoreState: domRestoreState,
      nativeRestoreState,
      accepted: !isFirstActiveLocation && nativeRestoreState === 'active' && engineReadyRef.current,
    }));
    // This is the persistence boundary: foliate's text-start relocation is
    // observable for diagnostics but cannot alter Native state or SQLite.
    if (domRestoreState !== 'active') return;
    if (isFirstActiveLocation) {
      activateEngine(location, 'dom-location');
      return;
    }
    if (restoreStateRef.current !== 'active' || !engineReadyRef.current) return;
    hasActiveLocationChangeRef.current = true;
    latestLocationRef.current = location;
    setCurrentLocation(location);
    scheduleLocationFlush();
  }, [activateEngine, scheduleLocationFlush]);

  const onEngineReady = useCallback(async (location: ReaderLocation) => {
    activateEngine(location, 'engine-ready');
    // Hydration itself must never write a location. The first location caused
    // by an active reader interaction becomes the first writable value.
  }, [activateEngine]);

  const onDiagnostic = useCallback(async (diagnostic: ReaderEngineDiagnostic) => {
    const book = currentBookRef.current;
    switch (diagnostic.event) {
      case 'DOM_READY':
      case 'ENGINE_OPENED':
      case 'ENGINE_DESTROY':
        console.log(`[${diagnostic.event}]`, JSON.stringify({ bookId: book?.id ?? null }));
        return;
      case 'RESTORE_REQUEST':
        restoreStateRef.current = 'restoring';
        console.log('[RESTORE_REQUEST]', JSON.stringify({ bookId: book?.id ?? null, targetCfi: diagnostic.targetCfi }));
        return;
      case 'RESTORE_RESULT':
        console.log('[RESTORE_RESULT]', JSON.stringify({
          bookId: book?.id ?? null,
          targetCfi: diagnostic.targetCfi,
          actualCurrentCfi: diagnostic.actualCurrentCfi,
        }));
        return;
      case 'LOCATION_CHANGED':
        return;
    }
  }, []);

  const onEngineError = useCallback(async (message: string) => {
    engineReadyRef.current = false;
    restoreStateRef.current = 'opening';
    hasActiveLocationChangeRef.current = false;
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

  return { state, currentLocation, flushLocation, onLocation, onEngineReady, onDiagnostic, onEngineError };
}
