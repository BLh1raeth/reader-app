import { AppState } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

import { bookRepository } from '../library/book-repository';
import type { Book } from '../library/library-types';
import { readingProgressRepository, type ReadingProgress } from './reading-progress-repository';
import { createFullEpubSource, readReaderEpubResource } from './reader-resource-bridge';
import { loadReaderData } from './reader-preload';
import { markReaderOpen } from './reader-open-performance';
import { readerPageCacheRepository, type ReaderPageCountCache } from './reader-page-cache-repository';
import { getGlobalReaderPage } from './reader-pagination';
import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
  readerLayoutSettingsEqual,
  readerSettingsEqual,
  type ReaderSettings,
} from './reader-settings';
import { readerSettingsRepository } from './reader-settings-repository';
import type { ReaderEngineDiagnostic, ReaderEpubSource, ReaderLocation, ReaderResourcePayload, ReaderRestoreState } from './reader-types';
import { takeReaderExternalNavigationRequest, type ReaderExternalNavigationRequest } from './reader-external-navigation';

const READER_SETTINGS_APPLY_DEBOUNCE_MS = 120;
const READER_SETTINGS_SAVE_DEBOUNCE_MS = 500;

type ReaderControllerState =
  | { kind: 'loading'; message: string }
  | { kind: 'opening'; book: Book; source: ReaderEpubSource; restoreCfi: string | null; externalTargetCfi: string | null }
  | { kind: 'ready'; book: Book; restoreCfi: string | null; externalTargetCfi: string | null }
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
  const [firstPageRendered, setFirstPageRendered] = useState(false);
  /** Excerpts Tab Core C: true when the external target was unresolvable. */
  const [externalTargetFailed, setExternalTargetFailed] = useState(false);
  const [pageCountCache, setPageCountCache] = useState<ReaderPageCountCache | null>(null);
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const [appliedReaderSettings, setAppliedReaderSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const latestLocationRef = useRef<ReaderLocation | null>(null);
  const currentBookRef = useRef<Book | null>(null);
  const sourceRef = useRef<ReaderEpubSource | null>(null);
  const restoreCfiRef = useRef<string | null>(null);
  /** Excerpts Tab Core C: one-shot external navigation target for this open. */
  const externalTargetCfiRef = useRef<string | null>(null);
  /**
   * Excerpts Tab Core C: the taken request, keyed by bookId so a re-run of
   * the open effect for the same book reuses it instead of taking twice
   * (the store itself is one-shot).
   */
  const externalNavigationRef = useRef<{ bookId: string; request: ReaderExternalNavigationRequest | null } | null>(null);
  const hasFallbackAttemptRef = useRef(false);
  const engineReadyRef = useRef(false);
  const restoreStateRef = useRef<ReaderRestoreState>('opening');
  const hasActiveLocationChangeRef = useRef(false);
  const lastPersistedCfiRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeQueueRef = useRef(Promise.resolve());
  const readerSettingsRef = useRef<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const settingsApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsWriteQueueRef = useRef(Promise.resolve());

  const persistReaderSettings = useCallback(async () => {
    const settings = readerSettingsRef.current;
    settingsWriteQueueRef.current = settingsWriteQueueRef.current
      .catch(() => undefined)
      .then(() => readerSettingsRepository.upsert(settings));
    await settingsWriteQueueRef.current;
  }, []);

  const commitReaderSettings = useCallback(async () => {
    if (settingsApplyTimerRef.current) {
      clearTimeout(settingsApplyTimerRef.current);
      settingsApplyTimerRef.current = null;
    }
    if (settingsSaveTimerRef.current) {
      clearTimeout(settingsSaveTimerRef.current);
      settingsSaveTimerRef.current = null;
    }
    setAppliedReaderSettings(readerSettingsRef.current);
    await persistReaderSettings();
  }, [persistReaderSettings]);

  const updateReaderSettings = useCallback((next: ReaderSettings) => {
    const normalized = normalizeReaderSettings(next);
    const previous = readerSettingsRef.current;
    if (readerSettingsEqual(previous, normalized)) return;
    const layoutChanged = !readerLayoutSettingsEqual(previous, normalized);
    readerSettingsRef.current = normalized;
    setReaderSettings(normalized);

    if (settingsApplyTimerRef.current) clearTimeout(settingsApplyTimerRef.current);
    if (layoutChanged) {
      settingsApplyTimerRef.current = setTimeout(() => {
        settingsApplyTimerRef.current = null;
        setAppliedReaderSettings(readerSettingsRef.current);
      }, READER_SETTINGS_APPLY_DEBOUNCE_MS);
    } else {
      settingsApplyTimerRef.current = null;
      setAppliedReaderSettings(normalized);
    }

    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = setTimeout(() => {
      settingsSaveTimerRef.current = null;
      void persistReaderSettings().catch(() => undefined);
    }, READER_SETTINGS_SAVE_DEBOUNCE_MS);
  }, [persistReaderSettings]);

  const flushLocation = useCallback(async () => {
    const book = currentBookRef.current;
    const location = latestLocationRef.current;
    if (!engineReadyRef.current || restoreStateRef.current !== 'active' || !hasActiveLocationChangeRef.current || !book || !location) return;
    if (lastPersistedCfiRef.current === location.cfi) return;
    const progress = toProgress(book.id, location);
    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await readingProgressRepository.upsert(progress);
        await bookRepository.recordReading(book.id);
        lastPersistedCfiRef.current = progress.cfi;
      });
    await writeQueueRef.current;
  }, []);

  const scheduleLocationFlush = useCallback(() => {
    if (!engineReadyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushLocation().catch(() => undefined);
    }, 800);
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
      ? { kind: 'ready', book: current.book, restoreCfi: current.restoreCfi, externalTargetCfi: current.externalTargetCfi }
      : current);
    console.log('[ENGINE_ACTIVE]', JSON.stringify({ bookId: currentBookRef.current?.id ?? null, cfi: location.cfi, source }));
    if (currentBookRef.current) markReaderOpen(currentBookRef.current.id, 'READER_VISIBLE', currentBookRef.current.fileSize, { source });
  }, []);

  const onLocation = useCallback(async (location: ReaderLocation, domRestoreState: ReaderRestoreState) => {
    const nativeRestoreState = restoreStateRef.current;
    const isFirstActiveLocation = domRestoreState === 'active' && nativeRestoreState !== 'active';
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

  const onResourceRequest = useCallback(async (name: string): Promise<ReaderResourcePayload | null> => {
    const book = currentBookRef.current;
    const source = sourceRef.current;
    if (!book || !source) return null;
    return readReaderEpubResource(book, source, name);
  }, []);

  const onPageCount = useCallback(async (result: Omit<ReaderPageCountCache, 'bookId' | 'updatedAt'>) => {
    const book = currentBookRef.current;
    const previous = latestLocationRef.current;
    if (!book) return;
    const cache: ReaderPageCountCache = {
      ...result,
      bookId: book.id,
      updatedAt: new Date().toISOString(),
    };
    setPageCountCache(cache);
    await readerPageCacheRepository.upsert(cache);
    // Page counting is a display-only cache update. Keep it outside the CFI
    // persistence path so it can never race Reader hydration.
    // A page turn may happen while SQLite commits the cache. Never let this
    // low-priority display update overwrite the live relocation that arrived
    // in the meantime.
    if (previous && latestLocationRef.current?.cfi === previous.cfi) {
      const currentPage = previous.currentPage === null
        ? null
        : getGlobalReaderPage(cache.sectionPages, previous.spineIndex, previous.currentPage);
      const nextLocation = { ...previous, currentPage, totalPages: cache.totalPages };
      latestLocationRef.current = nextLocation;
      setCurrentLocation(nextLocation);
    }
  }, []);

  const onDiagnostic = useCallback(async (diagnostic: ReaderEngineDiagnostic) => {
    const book = currentBookRef.current;
    switch (diagnostic.event) {
      case 'DOM_READY':
        if (book) markReaderOpen(book.id, 'DOM_READY', book.fileSize);
        console.log('[DOM_READY]', JSON.stringify({ bookId: book?.id ?? null }));
        return;
      case 'EPUB_TRANSFER_END':
        if (book) markReaderOpen(book.id, 'EPUB_TRANSFER_END', book.fileSize);
        return;
      case 'FOLIATE_OPEN_START':
        if (book) markReaderOpen(book.id, 'FOLIATE_OPEN_START', book.fileSize);
        return;
      case 'FOLIATE_IMPORT_START':
        if (book) markReaderOpen(book.id, 'FOLIATE_IMPORT_START', book.fileSize);
        return;
      case 'FOLIATE_IMPORT_END':
        if (book) markReaderOpen(book.id, 'FOLIATE_IMPORT_END', book.fileSize);
        return;
      case 'BOOK_BUILD_START':
        if (book) markReaderOpen(book.id, 'BOOK_BUILD_START', book.fileSize);
        return;
      case 'BOOK_BUILD_END':
        if (book) markReaderOpen(book.id, 'BOOK_BUILD_END', book.fileSize);
        return;
      case 'BOOK_OPEN_START':
        if (book) markReaderOpen(book.id, 'BOOK_OPEN_START', book.fileSize);
        return;
      case 'BOOK_OPEN_END':
        if (book) markReaderOpen(book.id, 'BOOK_OPEN_END', book.fileSize);
        return;
      case 'ENGINE_OPENED':
        if (book) markReaderOpen(book.id, 'FOLIATE_OPEN_END', book.fileSize);
        console.log('[ENGINE_OPENED]', JSON.stringify({ bookId: book?.id ?? null }));
        return;
      case 'STYLE_APPLY_START':
        if (book) markReaderOpen(book.id, 'STYLE_APPLY_START', book.fileSize);
        return;
      case 'STYLE_APPLY_END':
        if (book) markReaderOpen(book.id, 'STYLE_APPLY_END', book.fileSize);
        return;
      case 'VIEW_INIT_START':
        if (book) markReaderOpen(book.id, 'VIEW_INIT_START', book.fileSize);
        return;
      case 'VIEW_INIT_END':
        if (book) markReaderOpen(book.id, 'VIEW_INIT_END', book.fileSize);
        return;
      case 'PAGINATION_START':
        if (book) markReaderOpen(book.id, 'PAGINATION_START', book.fileSize);
        return;
      case 'PAGINATION_END':
        if (book) markReaderOpen(book.id, 'PAGINATION_END', book.fileSize);
        return;
      case 'FIRST_PAGE_RENDERED':
        setFirstPageRendered(true);
        if (book) markReaderOpen(book.id, 'FIRST_PAGE_RENDERED', book.fileSize);
        return;
      case 'ENGINE_DESTROY':
        console.log('[ENGINE_DESTROY]', JSON.stringify({ bookId: book?.id ?? null }));
        return;
      case 'RESTORE_REQUEST':
        restoreStateRef.current = 'restoring';
        if (book) markReaderOpen(book.id, 'RESTORE_START', book.fileSize, { hasSavedCfi: Boolean(diagnostic.targetCfi) });
        console.log('[RESTORE_REQUEST]', JSON.stringify({ bookId: book?.id ?? null, targetCfi: diagnostic.targetCfi }));
        return;
      case 'RESTORE_RESULT':
        if (book) markReaderOpen(book.id, 'RESTORE_END', book.fileSize, { restored: diagnostic.targetCfi === diagnostic.actualCurrentCfi });
        console.log('[RESTORE_RESULT]', JSON.stringify({
          bookId: book?.id ?? null,
          targetCfi: diagnostic.targetCfi,
          actualCurrentCfi: diagnostic.actualCurrentCfi,
        }));
        return;
      case 'EXTERNAL_TARGET_RESULT':
        // Excerpts Tab Core C: the engine reports whether the external
        // target resolved. On failure the reader already fell back to the
        // saved progress; surface the flag so the screen can show a
        // lightweight notice.
        if (!diagnostic.resolved) setExternalTargetFailed(true);
        return;
    }
  }, []);

  const onEngineError = useCallback(async (message: string) => {
    engineReadyRef.current = false;
    restoreStateRef.current = 'opening';
    hasActiveLocationChangeRef.current = false;
    latestLocationRef.current = null;
    setCurrentLocation(null);
    const book = currentBookRef.current;
    const source = sourceRef.current;
    if (book && source?.sourceKind === 'zip-resource-loader' && !hasFallbackAttemptRef.current) {
      hasFallbackAttemptRef.current = true;
      setState({ kind: 'loading', message: '正在使用兼容方式打开 EPUB' });
      try {
        const fallback = await createFullEpubSource(book);
        sourceRef.current = fallback;
        console.warn('[READER_RESOURCE]', '按需加载失败，已切换至完整 EPUB 兼容模式。', message);
        setState({ kind: 'opening', book, source: fallback, restoreCfi: restoreCfiRef.current, externalTargetCfi: externalTargetCfiRef.current });
        return;
      } catch (fallbackError) {
        setState({ kind: 'error', message: fallbackError instanceof Error ? fallbackError.message : message });
        return;
      }
    }
    setState({ kind: 'error', message });
  }, []);

  useEffect(() => {
    let active = true;
    engineReadyRef.current = false;
    latestLocationRef.current = null;
    lastPersistedCfiRef.current = null;
    sourceRef.current = null;
    setFirstPageRendered(false);
    setPageCountCache(null);
    restoreCfiRef.current = null;
    hasFallbackAttemptRef.current = false;
    setCurrentLocation(null);
    currentBookRef.current = null;
    if (!bookId) {
      setState({ kind: 'error', message: '找不到这本书。' });
      return undefined;
    }
    // Excerpts Tab Core C: consume a pending external navigation request for
    // this book, if any. take() is one-shot: rerenders, settings changes and
    // background/foreground cycles can never consume it twice. The taken
    // request is memoized per bookId so an effect re-run for the same book
    // reuses it instead of taking from the (now empty) store again.
    if (externalNavigationRef.current?.bookId !== bookId) {
      externalNavigationRef.current = { bookId, request: takeReaderExternalNavigationRequest(bookId) };
    }
    const externalNavigationRequest = externalNavigationRef.current.request;
    externalTargetCfiRef.current = externalNavigationRequest?.rangeCfi ?? null;
    setExternalTargetFailed(false);
    void (async () => {
      try {
        // Picks up the preload started on tap when one exists, so the EPUB
        // file read runs in parallel with the cover opening animation.
        const { book, source, savedProgress, pageCountCache, savedReaderSettings } = await loadReaderData(bookId);
        if (!active) return;
        currentBookRef.current = book;
        lastPersistedCfiRef.current = savedProgress?.cfi ?? null;
        restoreCfiRef.current = savedProgress?.cfi ?? null;
        sourceRef.current = source;
        setPageCountCache(pageCountCache);
        readerSettingsRef.current = savedReaderSettings;
        setReaderSettings(savedReaderSettings);
        setAppliedReaderSettings(savedReaderSettings);
        markReaderOpen(book.id, 'DOM_MOUNT_START', book.fileSize);
        markReaderOpen(book.id, 'EPUB_TRANSFER_START', book.fileSize, {
          sourceKind: source.sourceKind,
          base64Length: source.base64?.length ?? null,
          zipEntryCount: source.entries?.length ?? null,
          prefetchedFiles: Object.keys(source.prefetchedText ?? {}).length,
        });
        setState({ kind: 'opening', book, source, restoreCfi: savedProgress?.cfi ?? null, externalTargetCfi: externalTargetCfiRef.current });
      } catch (error) {
        if (!active) return;
        setState({ kind: 'error', message: error instanceof Error ? error.message : '无法打开这本书。' });
      }
    })();
    return () => {
      active = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (settingsApplyTimerRef.current) clearTimeout(settingsApplyTimerRef.current);
      if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
      void flushLocation().catch(() => undefined);
      void persistReaderSettings().catch(() => undefined);
    };
  }, [bookId, flushLocation, persistReaderSettings]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        if (settingsApplyTimerRef.current) clearTimeout(settingsApplyTimerRef.current);
        if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
        void flushLocation().catch(() => undefined);
        void commitReaderSettings().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [commitReaderSettings, flushLocation]);

  return {
    state,
    currentLocation,
    firstPageRendered,
    /** Excerpts Tab Core C: true when the external target was unresolvable. */
    externalTargetFailed,
    pageCountCache,
    readerSettings,
    appliedReaderSettings,
    updateReaderSettings,
    commitReaderSettings,
    flushLocation,
    onLocation,
    onEngineReady,
    onDiagnostic,
    onEngineError,
    onResourceRequest,
    onPageCount,
  };
}
