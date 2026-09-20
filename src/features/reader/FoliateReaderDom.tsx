'use dom';

import { useEffect, useRef } from 'react';

import {
  FoliateEpubEngineAdapter,
  READER_CONTENT_HEIGHT_REDUCTION_PX,
  READER_CONTENT_OFFSET_Y_PX,
  READER_PAGE_DISSOLVE_DELAY_MS,
  READER_PAGE_DISSOLVE_MS,
} from './foliate/FoliateEpubEngineAdapter';
import type { ReaderPageCountCache } from './reader-page-cache-repository';
import type { ReaderSettings } from './reader-settings';
import type {
  ReaderBookmarkNavigationRequest,
  ReaderBookmarkSnapshot,
  ReaderBookmarkSnapshotRequest,
  ReaderEngineDiagnostic,
  ReaderEpubSource,
  ReaderLocation,
  ReaderPageLocationRequest,
  ReaderPageLocationResult,
  ReaderResourcePayload,
  ReaderRestoreState,
  ReaderSearchNavigationRequest,
  ReaderSearchRequest,
  ReaderSearchResult,
  ReaderSelectionPayload,
  ReaderSelectionCommand,
  ReaderSelectionActionEvent,
  ReaderExcerptVerificationRequest,
  ReaderTocItem,
  ReaderTocNavigationRequest,
  FootnotePayload,
} from './reader-types';

type ReaderDomProps = import('expo/dom').DOMProps & {
  readerEditMenuEnabled?: boolean;
  onReaderSelectionAction?: (event: ReaderSelectionActionEvent) => void;
};

type Props = {
  source: ReaderEpubSource | null;
  restoreCfi: string | null;
  pageCountCache: ReaderPageCountCache | null;
  readerSettings: ReaderSettings;
  settingsSessionActive: boolean;
  tocNavigationRequest: ReaderTocNavigationRequest | null;
  bookmarkSnapshotRequest: ReaderBookmarkSnapshotRequest | null;
  bookmarkNavigationRequest: ReaderBookmarkNavigationRequest | null;
  pageLocationRequest: ReaderPageLocationRequest | null;
  searchRequest: ReaderSearchRequest | null;
  searchNavigationRequest: ReaderSearchNavigationRequest | null;
  selectionCommand: ReaderSelectionCommand | null;
  excerptVerificationRequest: ReaderExcerptVerificationRequest | null;
  onReady: (location: ReaderLocation) => Promise<void>;
  onLocation: (location: ReaderLocation, restoreState: ReaderRestoreState) => Promise<void>;
  onDiagnostic: (diagnostic: ReaderEngineDiagnostic) => Promise<void>;
  onChromeRequest: () => Promise<void>;
  onError: (message: string) => Promise<void>;
  onResourceRequest: (name: string) => Promise<ReaderResourcePayload | null>;
  onPageCount: (cache: Omit<ReaderPageCountCache, 'bookId' | 'updatedAt'>) => Promise<void>;
  onToc: (toc: ReaderTocItem[]) => Promise<void>;
  onTocNavigationResult: (requestId: number, succeeded: boolean, message: string | null) => Promise<void>;
  onBookmarkSnapshot: (requestId: number, snapshot: ReaderBookmarkSnapshot | null, message: string | null) => Promise<void>;
  onBookmarkNavigationResult: (requestId: number, succeeded: boolean, message: string | null) => Promise<void>;
  onPageLocationUpdate: (requestId: number, batch: ReaderPageLocationResult[], done: boolean, message: string | null) => Promise<void>;
  onSearchUpdate: (requestId: number, batch: ReaderSearchResult[], progress: number | null, done: boolean, message: string | null) => Promise<void>;
  onSearchNavigationResult: (requestId: number, succeeded: boolean, message: string | null) => Promise<void>;
  // Optional at the bridge boundary so a DOM bundle refreshed one frame ahead
  // of the Native/React bundle cannot call an undefined newly-added callback.
  onSelectionChange?: (selection: ReaderSelectionPayload | null) => Promise<void>;
  onFootnoteOpen?: (payload: FootnotePayload) => Promise<void>;
  // Plain boolean (not a function): read synchronously by the DOM gesture
  // layer on every pointer-up. While true, taps only dismiss the footnote
  // popover and never turn pages or toggle chrome.
  footnoteModalOpen: boolean;
  dom?: ReaderDomProps;
};

export default function FoliateReaderDom({ source, restoreCfi, pageCountCache, readerSettings, settingsSessionActive, tocNavigationRequest, bookmarkSnapshotRequest, bookmarkNavigationRequest, pageLocationRequest, searchRequest, searchNavigationRequest, selectionCommand, excerptVerificationRequest, onReady, onLocation, onDiagnostic, onChromeRequest, onError, onResourceRequest, onPageCount, onToc, onTocNavigationResult, onBookmarkSnapshot, onBookmarkNavigationResult, onPageLocationUpdate, onSearchUpdate, onSearchNavigationResult, onSelectionChange, onFootnoteOpen, footnoteModalOpen }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<FoliateEpubEngineAdapter | null>(null);
  const loadedSessionRef = useRef<string | null>(null);
  const settingsApplicationRef = useRef<Promise<void>>(Promise.resolve());
  const callbacksRef = useRef({ onReady, onLocation, onDiagnostic, onChromeRequest, onError, onResourceRequest, onPageCount, onToc, onTocNavigationResult, onBookmarkSnapshot, onBookmarkNavigationResult, onPageLocationUpdate, onSearchUpdate, onSearchNavigationResult, onSelectionChange, onFootnoteOpen, footnoteModalOpen });
  callbacksRef.current = { onReady, onLocation, onDiagnostic, onChromeRequest, onError, onResourceRequest, onPageCount, onToc, onTocNavigationResult, onBookmarkSnapshot, onBookmarkNavigationResult, onPageLocationUpdate, onSearchUpdate, onSearchNavigationResult, onSelectionChange, onFootnoteOpen, footnoteModalOpen };

  useEffect(() => {
    document.documentElement.lang = 'zh-CN';
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
    document.body.style.margin = '0';
    const root = document.getElementById('root');
    if (root) root.style.height = '100%';
    const transitionStyle = document.createElement('style');
    transitionStyle.textContent = `
      foliate-view.reader-reflowable::part(container) {
        height: calc(100% - ${READER_CONTENT_HEIGHT_REDUCTION_PX}px);
        transform: translateY(${READER_CONTENT_OFFSET_Y_PX}px);
      }
      /* Only the named foliate surface participates. Leaving WebKit's default
         root transition enabled lets it cross-fade a second snapshot behind
         the page, which makes otherwise identical turns look inconsistent. */
      ::view-transition-old(root),
      ::view-transition-new(root) {
        animation: none;
        opacity: 1;
      }
      ::view-transition-group(reader-page) {
        /* The page geometry is fixed. Disabling WebKit's default group
           transform leaves one compositor-only opacity transition. */
        animation: none;
      }
      ::view-transition-image-pair(reader-page) { isolation: isolate; }
      ::view-transition-old(reader-page) {
        animation: reader-old-page-dissolve ${READER_PAGE_DISSOLVE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1) ${READER_PAGE_DISSOLVE_DELAY_MS}ms both;
        backface-visibility: hidden;
        mix-blend-mode: normal;
        will-change: opacity;
      }
      ::view-transition-new(reader-page) {
        animation: reader-new-page-dissolve ${READER_PAGE_DISSOLVE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1) ${READER_PAGE_DISSOLVE_DELAY_MS}ms both;
        backface-visibility: hidden;
        mix-blend-mode: normal;
        will-change: opacity;
      }
      @keyframes reader-old-page-dissolve {
        0% { opacity: 1; }
        10% { opacity: 1; }
        38% { opacity: 0.58; }
        62% { opacity: 0; }
        100% { opacity: 0; }
      }
      @keyframes reader-new-page-dissolve {
        0% { opacity: 0; }
        18% { opacity: 0.14; }
        46% { opacity: 0.68; }
        74% { opacity: 1; }
        100% { opacity: 1; }
      }
    `;
    document.head.append(transitionStyle);
    void callbacksRef.current.onDiagnostic({ event: 'DOM_READY' });
    return () => transitionStyle.remove();
  }, []);

  useEffect(() => {
    const background = readerSettings.appearance === 'dark' ? '#151517' : '#F3F2F8';
    document.documentElement.style.backgroundColor = background;
    document.body.style.backgroundColor = background;
  }, [readerSettings.appearance]);

  useEffect(() => {
    const nextSource = source;
    if (!nextSource || loadedSessionRef.current === nextSource.sessionId || !hostRef.current) return;
    let active = true;
    void callbacksRef.current.onDiagnostic({ event: 'EPUB_TRANSFER_END' });
    const adapter = adapterRef.current ?? new FoliateEpubEngineAdapter(
      hostRef.current,
      (location, restoreState) => { void callbacksRef.current.onLocation(location, restoreState); },
      () => { void callbacksRef.current.onChromeRequest(); },
      (diagnostic) => { void callbacksRef.current.onDiagnostic(diagnostic); },
      (cache) => { void callbacksRef.current.onPageCount(cache); },
      (toc) => { void callbacksRef.current.onToc(toc); },
      (selection) => {
        const callback = callbacksRef.current.onSelectionChange;
        if (typeof callback === 'function') void callback(selection);
      },
      (payload) => {
        const callback = callbacksRef.current.onFootnoteOpen;
        if (typeof callback === 'function') void callback(payload);
      },
      // Getter (not a snapshot): the adapter is constructed once, but the
      // modal flag changes over time; callbacksRef always holds the latest.
      () => callbacksRef.current.footnoteModalOpen,
    );
    adapterRef.current = adapter;
    loadedSessionRef.current = nextSource.sessionId;
    void callbacksRef.current.onDiagnostic({ event: 'FOLIATE_OPEN_START' });
    void callbacksRef.current.onDiagnostic({ event: 'FOLIATE_IMPORT_START' });
    void adapter.open({
      bookId: nextSource.bookId,
      base64: nextSource.base64,
      entries: nextSource.entries,
      fileName: nextSource.fileName,
      onResourceRequest: (name) => callbacksRef.current.onResourceRequest(name),
      prefetchedText: nextSource.prefetchedText,
      restoreCfi,
      sourceKind: nextSource.sourceKind,
      pageCountCache,
      readerSettings,
    }).then((location) => {
      if (!active) return undefined;
      return callbacksRef.current.onReady(location);
    }).catch((error: unknown) => {
      if (!active) return;
      loadedSessionRef.current = null;
      const message = error instanceof Error ? error.message : String(error);
      void callbacksRef.current.onError(message);
    });
    return () => { active = false; };
  }, [pageCountCache, restoreCfi, source]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !loadedSessionRef.current) return;
    settingsApplicationRef.current = adapter.applySettings(readerSettings).catch((error: unknown) => {
      // A settings preview failure must not tear down an otherwise healthy
      // Reader or trigger the EPUB source fallback path.
      console.warn('[READER_SETTINGS_FAILED]', error);
    });
  }, [readerSettings]);

  useEffect(() => {
    adapterRef.current?.setSettingsSessionActive(settingsSessionActive);
  }, [settingsSessionActive]);

  useEffect(() => {
    const request = tocNavigationRequest;
    const adapter = adapterRef.current;
    if (!request || !adapter) return;
    let active = true;
    void adapter.goTo(request.href).then(() => {
      if (active) return callbacksRef.current.onTocNavigationResult(request.id, true, null);
      return undefined;
    }).catch((error) => {
      const message = error instanceof Error ? error.message : '无法跳转到该目录条目。';
      console.warn('[TOC_NAVIGATION_FAILED]', JSON.stringify({ requestId: request.id, href: request.href, message }));
      if (active) return callbacksRef.current.onTocNavigationResult(request.id, false, message);
      return undefined;
    });
    return () => { active = false; };
  }, [tocNavigationRequest]);

  useEffect(() => {
    const request = bookmarkSnapshotRequest;
    const adapter = adapterRef.current;
    if (!request || !adapter) return;
    let active = true;
    void adapter.getBookmarkSnapshot(request.bookmarks).then((snapshot) => {
      if (active) return callbacksRef.current.onBookmarkSnapshot(request.id, snapshot, null);
      return undefined;
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '无法取得当前书签位置。';
      if (active) return callbacksRef.current.onBookmarkSnapshot(request.id, null, message);
      return undefined;
    });
    return () => { active = false; };
  }, [bookmarkSnapshotRequest?.id]);

  useEffect(() => {
    const request = bookmarkNavigationRequest;
    const adapter = adapterRef.current;
    if (!request || !adapter) return;
    let active = true;
    void adapter.goTo(request.cfi).then(() => {
      if (active) return callbacksRef.current.onBookmarkNavigationResult(request.id, true, null);
      return undefined;
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '无法跳转到该书签。';
      if (active) return callbacksRef.current.onBookmarkNavigationResult(request.id, false, message);
      return undefined;
    });
    return () => { active = false; };
  }, [bookmarkNavigationRequest?.id]);

  useEffect(() => {
    const request = pageLocationRequest;
    const adapter = adapterRef.current;
    if (!request || !adapter) return;
    let active = true;
    void adapter.locatePages(request.layoutSignature, request.targets, (batch, done) => {
      if (active) void callbacksRef.current.onPageLocationUpdate(request.id, batch, done, null);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '无法解析页码位置。';
      if (active) void callbacksRef.current.onPageLocationUpdate(request.id, [], true, message);
    });
    return () => {
      active = false;
      adapter.cancelPageLocation();
    };
  }, [pageLocationRequest?.id]);

  useEffect(() => {
    const request = searchRequest;
    const adapter = adapterRef.current;
    if (!request || !adapter) return;
    let active = true;
    void adapter.search(request.query, (batch, progress, done) => {
      if (active) void callbacksRef.current.onSearchUpdate(request.id, batch, progress, done, null);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '无法搜索此书。';
      console.warn('[BOOK_SEARCH_FAILED]', JSON.stringify({ requestId: request.id, message }));
      if (active) void callbacksRef.current.onSearchUpdate(request.id, [], null, true, message);
    });
    return () => {
      active = false;
      adapter.cancelSearch();
    };
  // Expo DOM serializes object props on each Native render. Depending on the
  // object identity restarted the same incremental search after every batch.
  // A request id is the stable ownership boundary for one physical search.
  }, [searchRequest?.id]);

  useEffect(() => {
    const request = searchNavigationRequest;
    const adapter = adapterRef.current;
    if (!request || !adapter) return;
    let active = true;
    void adapter.goToSearchResult(request.cfi).then(() => {
      if (active) return callbacksRef.current.onSearchNavigationResult(request.id, true, null);
      return undefined;
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '无法跳转到搜索结果。';
      console.warn('[SEARCH_NAVIGATION_FAILED]', JSON.stringify({ requestId: request.id, message }));
      if (active) return callbacksRef.current.onSearchNavigationResult(request.id, false, message);
      return undefined;
    });
    return () => { active = false; };
  }, [searchNavigationRequest?.id]);

  useEffect(() => {
    if (selectionCommand?.type === 'clear') adapterRef.current?.clearSelection();
  }, [selectionCommand?.id]);

  useEffect(() => {
    const request = excerptVerificationRequest;
    const adapter = adapterRef.current;
    if (!request || !adapter) return;
    void settingsApplicationRef.current.then(() => adapter.verifyExcerptAnchors(request.items));
  }, [excerptVerificationRequest?.id]);

  useEffect(() => () => {
    adapterRef.current?.destroy();
    adapterRef.current = null;
  }, []);

  return (
    <div
      ref={hostRef}
      style={{
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
        background: readerSettings.appearance === 'dark' ? '#151517' : '#F3F2F8',
      }}
    />
  );
}
