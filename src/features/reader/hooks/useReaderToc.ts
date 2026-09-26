import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReaderBookmark } from '../bookmark-repository';
import type {
  ReaderBookmarkNavigationRequest,
  ReaderTocItem,
  ReaderTocNavigationRequest,
} from '../reader-types';

/**
 * ReaderScreen 巨型组件拆分：目录（TOC）与书签跳转。
 *
 * 从 ReaderScreen 原样搬运：所有 state、ref、callback 与依赖数组保持不变。
 * 交叉依赖显式作为参数传入：
 * - markReaderActivity：打开目录算一次阅读活动。
 * - setTocSheetPresented / setSettingsSheetPresented / setSearchSheetPresented：
 *   打开目录时关闭另外两个 sheet。
 * - cancelSearchRequest：打开目录时取消 in-flight 的搜索请求（useReaderSearch 的窄接口）。
 *
 * 注意：书签的增删改查（bookmarks 数据）归 useReaderBookmarks；这里只管
 * TOC sheet 内的跳转与导航请求。
 */
export function useReaderToc({
  bookId,
  markReaderActivity,
  setTocSheetPresented,
  setSettingsSheetPresented,
  setSearchSheetPresented,
  cancelSearchRequest,
}: {
  bookId: string | undefined;
  markReaderActivity: () => void;
  setTocSheetPresented: (presented: boolean) => void;
  setSettingsSheetPresented: (presented: boolean) => void;
  setSearchSheetPresented: (presented: boolean) => void;
  cancelSearchRequest: () => void;
}) {
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [tocNavigating, setTocNavigating] = useState(false);
  const [tocNavigationRequest, setTocNavigationRequest] = useState<ReaderTocNavigationRequest | null>(null);
  const [bookmarkNavigationRequest, setBookmarkNavigationRequest] = useState<ReaderBookmarkNavigationRequest | null>(null);
  const pendingTocItemRef = useRef<ReaderTocItem | null>(null);
  const pendingBookmarkRef = useRef<ReaderBookmark | null>(null);
  const tocRequestSequenceRef = useRef(0);
  const bookmarkNavigationSequenceRef = useRef(0);

  // 换书时重置目录状态（原 ReaderScreen 内 bookId 重置 effect 的一部分）。
  useEffect(() => {
    pendingTocItemRef.current = null;
    pendingBookmarkRef.current = null;
    setToc([]);
    setTocNavigating(false);
    setTocNavigationRequest(null);
    setBookmarkNavigationRequest(null);
  }, [bookId]);

  const openToc = useCallback(() => {
    markReaderActivity();
    pendingTocItemRef.current = null;
    pendingBookmarkRef.current = null;
    setTocNavigating(false);
    setSettingsSheetPresented(false);
    setSearchSheetPresented(false);
    cancelSearchRequest();
    setTocSheetPresented(true);
  }, [markReaderActivity, setSettingsSheetPresented, setSearchSheetPresented, cancelSearchRequest, setTocSheetPresented]);

  const selectTocItem = useCallback((item: ReaderTocItem) => {
    if (tocNavigating) return;
    pendingBookmarkRef.current = null;
    pendingTocItemRef.current = item;
    setTocNavigating(true);
    setTocSheetPresented(false);
  }, [tocNavigating, setTocSheetPresented]);

  const selectBookmark = useCallback((bookmark: ReaderBookmark) => {
    if (tocNavigating) return;
    pendingTocItemRef.current = null;
    pendingBookmarkRef.current = bookmark;
    setTocNavigating(true);
    setTocSheetPresented(false);
  }, [tocNavigating, setTocSheetPresented]);

  const handleTocSheetDismissed = useCallback(() => {
    const bookmark = pendingBookmarkRef.current;
    pendingBookmarkRef.current = null;
    if (bookmark) {
      setBookmarkNavigationRequest({ id: ++bookmarkNavigationSequenceRef.current, cfi: bookmark.cfi, reason: 'bookmark' });
      return;
    }
    const target = pendingTocItemRef.current;
    pendingTocItemRef.current = null;
    if (!target) {
      setTocNavigating(false);
      return;
    }
    setTocNavigationRequest({ id: ++tocRequestSequenceRef.current, href: target.href, reason: 'toc' });
  }, []);

  const handleBookmarkNavigationResult = useCallback(async (requestId: number, succeeded: boolean, message: string | null) => {
    setBookmarkNavigationRequest((request) => request?.id === requestId ? null : request);
    setTocNavigating(false);
    if (!succeeded) console.warn('[BOOKMARK_NAVIGATION_FAILED]', JSON.stringify({ requestId, message }));
  }, []);

  const handleTocNavigationResult = useCallback(async (requestId: number, succeeded: boolean, message: string | null) => {
    setTocNavigationRequest((request) => request?.id === requestId ? null : request);
    setTocNavigating(false);
    if (!succeeded) console.warn('[TOC_NAVIGATION_FAILED]', JSON.stringify({ requestId, message }));
  }, []);

  const handleToc = useCallback(async (nextToc: ReaderTocItem[]) => {
    setToc(nextToc);
  }, []);

  return {
    toc,
    tocNavigating,
    tocNavigationRequest,
    bookmarkNavigationRequest,
    openToc,
    selectTocItem,
    selectBookmark,
    handleTocSheetDismissed,
    handleBookmarkNavigationResult,
    handleTocNavigationResult,
    handleToc,
  };
}
