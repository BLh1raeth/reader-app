import { useCallback, useEffect, useRef, useState } from 'react';
import { bookSearchHistoryRepository, type BookSearchHistoryItem } from '../book-search-history-repository';
import type {
  ReaderSearchInitialQueryRequest,
  ReaderSearchNavigationRequest,
  ReaderSearchRequest,
  ReaderSearchResult,
} from '../reader-types';

/**
 * ReaderScreen 巨型组件拆分：全文搜索（搜索 sheet、搜词、结果流、历史记录、结果跳转）。
 *
 * 从 ReaderScreen 原样搬运：所有 state、ref、callback 与依赖数组保持不变。
 * 交叉依赖显式作为参数传入：
 * - setTocSheetPresented / setSettingsSheetPresented：打开搜索时关闭另外两个 sheet。
 *
 * 额外暴露两个窄接口供其他 hook 调用（原组件内直接调用的跨功能点）：
 * - cancelSearchRequest：只清掉 in-flight 的搜索请求（不清结果），供 openToc 调用。
 * - requestInitialSearchQuery：选中文字后"在书中搜索"时预填搜词，供 useReaderSelection 调用。
 */
export function useReaderSearch({
  bookId,
  markReaderActivity,
  setTocSheetPresented,
  setSettingsSheetPresented,
  setSearchSheetPresented,
}: {
  bookId: string | undefined;
  markReaderActivity: () => void;
  setTocSheetPresented: (presented: boolean) => void;
  setSettingsSheetPresented: (presented: boolean) => void;
  setSearchSheetPresented: (presented: boolean) => void;
}) {
  const [searchNavigationRequest, setSearchNavigationRequest] = useState<ReaderSearchNavigationRequest | null>(null);
  const [searchRequest, setSearchRequest] = useState<ReaderSearchRequest | null>(null);
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<BookSearchHistoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchComplete, setSearchComplete] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchInitialQueryRequest, setSearchInitialQueryRequest] = useState<ReaderSearchInitialQueryRequest | null>(null);
  const pendingSearchResultRef = useRef<ReaderSearchResult | null>(null);
  const searchRequestSequenceRef = useRef(0);
  const searchNavigationSequenceRef = useRef(0);
  const searchInitialQuerySequenceRef = useRef(0);
  const activeSearchRequestRef = useRef<ReaderSearchRequest | null>(null);

  // 换书时重置搜索状态（原 ReaderScreen 内 bookId 重置 effect 的一部分）。
  useEffect(() => {
    setSearchNavigationRequest(null);
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
    setSearchResults([]);
    setRecentSearches([]);
    setSearching(false);
    setSearchComplete(false);
    setSearchError(null);
    setSearchInitialQueryRequest(null);
  }, [bookId]);

  const openSearch = useCallback(() => {
    if (!bookId) return;
    markReaderActivity();
    pendingSearchResultRef.current = null;
    setTocSheetPresented(false);
    setSettingsSheetPresented(false);
    setSearchResults([]);
    setSearching(false);
    setSearchComplete(false);
    setSearchError(null);
    setSearchSheetPresented(true);
    void bookSearchHistoryRepository.list(bookId).then(setRecentSearches).catch((error: unknown) => {
      console.warn('[SEARCH_HISTORY_LOAD_FAILED]', error);
    });
  }, [bookId, markReaderActivity, setTocSheetPresented, setSettingsSheetPresented, setSearchSheetPresented]);

  const cancelSearch = useCallback(() => {
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
    setSearchResults([]);
    setSearching(false);
    setSearchComplete(false);
    setSearchError(null);
  }, []);

  // 窄版：只取消 in-flight 请求，不清结果列表。openToc 关闭搜索 sheet 时调用。
  const cancelSearchRequest = useCallback(() => {
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
  }, []);

  const requestSearch = useCallback((rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) {
      cancelSearch();
      return;
    }
    const request = { id: ++searchRequestSequenceRef.current, query };
    activeSearchRequestRef.current = request;
    setSearchResults([]);
    setSearching(true);
    setSearchComplete(false);
    setSearchError(null);
    setSearchRequest(request);
  }, [cancelSearch]);

  const commitSearch = useCallback((query: string) => {
    requestSearch(query);
    if (!bookId) return;
    void bookSearchHistoryRepository.record(bookId, query).then(setRecentSearches).catch((error: unknown) => {
      console.warn('[SEARCH_HISTORY_WRITE_FAILED]', error);
    });
  }, [bookId, requestSearch]);

  const clearRecentSearches = useCallback(() => {
    if (!bookId) return;
    setRecentSearches([]);
    void bookSearchHistoryRepository.clear(bookId).catch((error: unknown) => {
      console.warn('[SEARCH_HISTORY_CLEAR_FAILED]', error);
    });
  }, [bookId]);

  const handleSearchUpdate = useCallback(async (
    requestId: number,
    batch: ReaderSearchResult[],
    _progress: number | null,
    done: boolean,
    message: string | null,
  ) => {
    if (activeSearchRequestRef.current?.id !== requestId) return;
    if (batch.length) {
      setSearchResults((current) => {
        const seen = new Set(current.map((result) => result.cfi));
        const uniqueBatch = batch.filter((result) => {
          if (seen.has(result.cfi)) return false;
          seen.add(result.cfi);
          return true;
        });
        return uniqueBatch.length ? [...current, ...uniqueBatch] : current;
      });
    }
    if (message) setSearchError(message);
    if (done) {
      setSearching(false);
      setSearchComplete(true);
    }
  }, []);

  const selectSearchResult = useCallback((result: ReaderSearchResult, query: string) => {
    pendingSearchResultRef.current = result;
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
    setSearchSheetPresented(false);
    if (bookId) {
      void bookSearchHistoryRepository.record(bookId, query).then(setRecentSearches).catch((error: unknown) => {
        console.warn('[SEARCH_HISTORY_WRITE_FAILED]', error);
      });
    }
  }, [bookId, setSearchSheetPresented]);

  const requestSearchSheetDismiss = useCallback(() => {
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
    setSearchSheetPresented(false);
  }, [setSearchSheetPresented]);

  const handleSearchSheetDismissed = useCallback(() => {
    const target = pendingSearchResultRef.current;
    pendingSearchResultRef.current = null;
    cancelSearch();
    if (!target) return;
    setSearchNavigationRequest({ id: ++searchNavigationSequenceRef.current, cfi: target.cfi, reason: 'search' });
  }, [cancelSearch]);

  const handleSearchNavigationResult = useCallback(async (requestId: number, succeeded: boolean, message: string | null) => {
    setSearchNavigationRequest((request) => request?.id === requestId ? null : request);
    if (!succeeded) console.warn('[SEARCH_NAVIGATION_FAILED]', JSON.stringify({ requestId, message }));
  }, []);

  const requestInitialSearchQuery = useCallback((query: string) => {
    setSearchInitialQueryRequest({ id: ++searchInitialQuerySequenceRef.current, query });
  }, []);

  return {
    searchNavigationRequest,
    searchRequest,
    searchResults,
    recentSearches,
    searching,
    searchComplete,
    searchError,
    searchInitialQueryRequest,
    openSearch,
    cancelSearch,
    cancelSearchRequest,
    requestSearch,
    commitSearch,
    clearRecentSearches,
    handleSearchUpdate,
    selectSearchResult,
    requestSearchSheetDismiss,
    handleSearchSheetDismissed,
    handleSearchNavigationResult,
    requestInitialSearchQuery,
  };
}
