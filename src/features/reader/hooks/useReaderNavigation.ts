import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { cancelAnimation, Easing, withTiming, type SharedValue } from 'react-native-reanimated';
import type { ReaderBookmark } from '../bookmark-repository';
import type { ReaderPageCountCache } from '../reader-page-cache-repository';
import { takeReaderExternalNavigationRequest, type ReaderExternalNavigationRequest } from '../reader-external-navigation';
import type {
  ReaderLocation,
  ReaderPageLocationRequest,
  ReaderPageLocationResult,
  ReaderSearchResult,
  ReaderTocItem,
} from '../reader-types';

const PAGE_INDICATOR_FADE_OUT_MS = 96;
const PAGE_INDICATOR_FADE_IN_MS = 144;

function collectTocPageTargets(items: ReaderTocItem[], targets: Map<string, string>) {
  for (const item of items) {
    if (item.href) targets.set(item.href, `toc:${item.id ?? item.href}`);
    if (item.subitems?.length) collectTocPageTargets(item.subitems, targets);
  }
}

/**
 * ReaderScreen 巨型组件拆分：外部导航（摘录跳转、页码定位、页码指示器）。
 *
 * 从 ReaderScreen 原样搬运：所有 state、ref、callback、memo、effect 与依赖数组保持不变。
 * 交叉依赖显式作为参数传入：
 * - toc：目录项用于页码定位目标（useReaderToc）。
 * - bookmarks：书签用于页码定位目标（useReaderBookmarks）。
 * - searchComplete / searchResults：搜索结果用于页码定位目标（useReaderSearch）。
 * - currentLocation / pageCountCache / externalTargetFailed / isReady：控制器状态。
 * - reduceMotion / pageIndicatorOpacity：页码指示器动画。
 */
export function useReaderNavigation({
  bookId,
  toc,
  bookmarks,
  searchComplete,
  searchResults,
  currentLocation,
  pageCountCache,
  externalTargetFailed,
  isReady,
  reduceMotion,
  pageIndicatorOpacity,
  isFocused,
}: {
  bookId: string | undefined;
  toc: ReaderTocItem[];
  bookmarks: ReaderBookmark[];
  searchComplete: boolean;
  searchResults: ReaderSearchResult[];
  currentLocation: ReaderLocation | null;
  pageCountCache: ReaderPageCountCache | null;
  externalTargetFailed: boolean;
  isReady: boolean;
  reduceMotion: boolean;
  pageIndicatorOpacity: SharedValue<number>;
  isFocused: boolean;
}) {
  const [pageLocationRequest, setPageLocationRequest] = useState<ReaderPageLocationRequest | null>(null);
  const [pageByDestination, setPageByDestination] = useState<Record<string, number>>({});
  const [excerptNavigationRequest, setExcerptNavigationRequest] = useState<ReaderExternalNavigationRequest | null>(null);
  const [externalNavMessage, setExternalNavMessage] = useState<string | null>(null);
  const [displayedPageLocation, setDisplayedPageLocation] = useState<ReaderLocation | null>(null);
  const displayedPageLocationRef = useRef<ReaderLocation | null>(null);
  const pageIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageLocationSequenceRef = useRef(0);
  const activePageLocationRequestRef = useRef<ReaderPageLocationRequest | null>(null);
  const externalNavMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 换书时重置导航状态（原 ReaderScreen 内 bookId 重置 effect 的一部分）。
  useEffect(() => {
    activePageLocationRequestRef.current = null;
    setPageLocationRequest(null);
    setPageByDestination({});
    displayedPageLocationRef.current = null;
    setDisplayedPageLocation(null);
    if (externalNavMessageTimerRef.current) {
      clearTimeout(externalNavMessageTimerRef.current);
      externalNavMessageTimerRef.current = null;
    }
    setExternalNavMessage(null);
    setExcerptNavigationRequest(null);
  }, [bookId]);

  const activePaginationCache = pageCountCache
    && currentLocation?.totalPages === pageCountCache.totalPages
    ? pageCountCache
    : null;
  const pageLocationTargets = useMemo(() => {
    const targetKeys = new Map<string, string>();
    collectTocPageTargets(toc, targetKeys);
    for (const bookmark of bookmarks) targetKeys.set(bookmark.cfi, `bookmark:${bookmark.id}`);
    if (searchComplete) {
      for (const result of searchResults) targetKeys.set(result.cfi, `search:${result.id}`);
    }
    return Array.from(targetKeys, ([destination, key]) => ({ key, destination }));
  }, [bookmarks, searchComplete, searchResults, toc]);
  const pageLocationTargetSignature = useMemo(
    () => pageLocationTargets.map((target) => `${target.key}\u0000${target.destination}`).join('\u0001'),
    [pageLocationTargets],
  );
  const displayedSearchResults = useMemo(() => searchResults.map((result) => ({
    ...result,
    pageNumber: pageByDestination[result.cfi] ?? null,
  })), [pageByDestination, searchResults]);

  useEffect(() => {
    if (!activePaginationCache || !pageLocationTargets.length) {
      activePageLocationRequestRef.current = null;
      setPageLocationRequest(null);
      setPageByDestination({});
      return;
    }
    const request: ReaderPageLocationRequest = {
      id: ++pageLocationSequenceRef.current,
      layoutSignature: activePaginationCache.layoutSignature,
      targets: pageLocationTargets,
    };
    activePageLocationRequestRef.current = request;
    setPageByDestination({});
    setPageLocationRequest(request);
  }, [activePaginationCache?.layoutSignature, pageLocationTargetSignature]);

  const handlePageLocationUpdate = useCallback(async (
    requestId: number,
    batch: ReaderPageLocationResult[],
    done: boolean,
    message: string | null,
  ) => {
    if (activePageLocationRequestRef.current?.id !== requestId) return;
    if (batch.length) {
      setPageByDestination((current) => {
        const next = { ...current };
        for (const result of batch) next[result.destination] = result.pageNumber;
        return next;
      });
    }
    if (message) console.warn('[PAGE_LOCATION_FAILED]', JSON.stringify({ requestId, message }));
    if (done) {
      activePageLocationRequestRef.current = null;
      setPageLocationRequest((current) => current?.id === requestId ? null : current);
    }
  }, []);

  // Excerpts Tab Core C: self-dismissing transient notice. There is no
  // app-wide toast system, so this stays local to the Reader screen.
  const showExternalNavMessage = useCallback((message: string) => {
    if (externalNavMessageTimerRef.current) clearTimeout(externalNavMessageTimerRef.current);
    setExternalNavMessage(message);
    externalNavMessageTimerRef.current = setTimeout(() => {
      externalNavMessageTimerRef.current = null;
      setExternalNavMessage(null);
    }, 2500);
  }, []);

  const handleExcerptNavigationResult = useCallback(async (requestId: number, succeeded: boolean, message: string | null) => {
    setExcerptNavigationRequest((request) => request?.id === requestId ? null : request);
    if (!succeeded) showExternalNavMessage(message ?? '无法定位到原摘录位置');
  }, [showExternalNavMessage]);

  // Excerpts Tab Core C (cold path): the engine validated the external target
  // during open and fell back to the saved progress when it was unresolvable.
  // Wait for the ready state so the notice is visible, not hidden behind the
  // opening overlay.
  useEffect(() => {
    if (externalTargetFailed && isReady) showExternalNavMessage('无法定位到原摘录位置');
  }, [externalTargetFailed, isReady, showExternalNavMessage]);

  // 页码指示器：位置变化时淡出-更新-淡入。
  useEffect(() => {
    const nextLocation = currentLocation;
    const displayedLocation = displayedPageLocationRef.current;
    const fadeOutDuration = reduceMotion ? 40 : PAGE_INDICATOR_FADE_OUT_MS;
    const fadeInDuration = reduceMotion ? 60 : PAGE_INDICATOR_FADE_IN_MS;
    if (pageIndicatorTimerRef.current) {
      clearTimeout(pageIndicatorTimerRef.current);
      pageIndicatorTimerRef.current = null;
    }
    cancelAnimation(pageIndicatorOpacity);

    if (!nextLocation) {
      displayedPageLocationRef.current = null;
      setDisplayedPageLocation(null);
      pageIndicatorOpacity.set(0);
      return;
    }

    if (!displayedLocation) {
      displayedPageLocationRef.current = nextLocation;
      setDisplayedPageLocation(nextLocation);
      pageIndicatorOpacity.set(withTiming(1, {
        duration: reduceMotion ? 60 : 120,
        easing: Easing.out(Easing.cubic),
      }));
      return;
    }

    const visiblePageChanged = displayedLocation.currentPage !== nextLocation.currentPage
      || displayedLocation.totalPages !== nextLocation.totalPages;
    if (!visiblePageChanged) {
      displayedPageLocationRef.current = nextLocation;
      setDisplayedPageLocation(nextLocation);
      return;
    }

    pageIndicatorOpacity.set(withTiming(0, {
      duration: fadeOutDuration,
      easing: Easing.in(Easing.cubic),
    }));
    pageIndicatorTimerRef.current = setTimeout(() => {
      pageIndicatorTimerRef.current = null;
      displayedPageLocationRef.current = nextLocation;
      setDisplayedPageLocation(nextLocation);
      pageIndicatorOpacity.set(withTiming(1, {
        duration: fadeInDuration,
        easing: Easing.out(Easing.cubic),
      }));
    }, fadeOutDuration);
  }, [currentLocation, pageIndicatorOpacity, reduceMotion]);

  useEffect(() => () => {
    if (pageIndicatorTimerRef.current) clearTimeout(pageIndicatorTimerRef.current);
    cancelAnimation(pageIndicatorOpacity);
  }, [pageIndicatorOpacity]);

  // Excerpts Tab Core C (warm path): the book is already open and this reader
  // instance is focused. A pending request that arrived after the initial
  // open is consumed here; the store is one-shot so it can never replay.
  useEffect(() => {
    if (!isFocused || !isReady || !bookId) return;
    const request = takeReaderExternalNavigationRequest(bookId);
    if (request) setExcerptNavigationRequest(request);
  }, [isFocused, isReady, bookId]);

  return {
    pageLocationRequest,
    pageByDestination,
    excerptNavigationRequest,
    externalNavMessage,
    displayedPageLocation,
    displayedSearchResults,
    handlePageLocationUpdate,
    showExternalNavMessage,
    handleExcerptNavigationResult,
  };
}
