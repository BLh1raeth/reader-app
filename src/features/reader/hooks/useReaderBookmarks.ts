import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bookmarkRepository, type ReaderBookmark } from '../bookmark-repository';
import type {
  ReaderBookmarkSnapshot,
  ReaderBookmarkSnapshotRequest,
  ReaderLocation,
} from '../reader-types';

/**
 * ReaderScreen 巨型组件拆分：书签数据（加载、增删、当前页书签状态、快照请求）。
 *
 * 从 ReaderScreen 原样搬运：所有 state、ref、callback、effect 与依赖数组保持不变。
 * 交叉依赖显式作为参数传入：
 * - markReaderActivity：切换书签算一次阅读活动。
 * - currentLocation：当前阅读位置（用于书签锚点、状态查询与切换）。
 * - layoutSignature：排版签名变化时刷新书签状态。
 *
 * 注意：书签跳转（bookmarkNavigationRequest）归 useReaderToc；这里只管书签数据。
 */
export function useReaderBookmarks({
  bookId,
  markReaderActivity,
  currentLocation,
  layoutSignature,
}: {
  bookId: string | undefined;
  markReaderActivity: () => void;
  currentLocation: ReaderLocation | null;
  layoutSignature: string | undefined;
}) {
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [currentBookmarked, setCurrentBookmarked] = useState(false);
  const [bookmarkSnapshotRequest, setBookmarkSnapshotRequest] = useState<ReaderBookmarkSnapshotRequest | null>(null);
  const bookmarkSnapshotSequenceRef = useRef(0);
  const activeBookmarkSnapshotRequestRef = useRef<ReaderBookmarkSnapshotRequest | null>(null);

  // 换书时重置书签状态（原 ReaderScreen 内 bookId 重置 effect 的一部分）。
  useEffect(() => {
    activeBookmarkSnapshotRequestRef.current = null;
    setBookmarks([]);
    setBookmarksLoaded(false);
    setBookmarkBusy(false);
    setCurrentBookmarked(false);
    setBookmarkSnapshotRequest(null);
  }, [bookId]);

  // 换书时从仓库加载书签列表。
  useEffect(() => {
    if (!bookId) return undefined;
    let active = true;
    void bookmarkRepository.list(bookId).then((items) => {
      if (!active) return;
      setBookmarks(items);
      setBookmarksLoaded(true);
    }).catch((error: unknown) => {
      console.warn('[BOOKMARK_LOAD_FAILED]', error);
      if (active) setBookmarksLoaded(true);
    });
    return () => { active = false; };
  }, [bookId]);

  const bookmarkAnchors = useMemo(() => bookmarks
    .filter((bookmark) => bookmark.spineIndex === currentLocation?.spineIndex)
    .map((bookmark) => ({
      id: bookmark.id,
      cfi: bookmark.cfi,
      spineIndex: bookmark.spineIndex,
    })), [bookmarks, currentLocation?.spineIndex]);

  const requestBookmarkSnapshot = useCallback((intent: ReaderBookmarkSnapshotRequest['intent']) => {
    const request: ReaderBookmarkSnapshotRequest = {
      id: ++bookmarkSnapshotSequenceRef.current,
      intent,
      bookmarks: bookmarkAnchors,
    };
    activeBookmarkSnapshotRequestRef.current = request;
    setBookmarkSnapshotRequest(request);
  }, [bookmarkAnchors]);

  useEffect(() => {
    if (!bookmarksLoaded || !currentLocation || bookmarkBusy) return;
    requestBookmarkSnapshot('status');
  }, [bookmarkBusy, bookmarksLoaded, currentLocation?.cfi, layoutSignature, requestBookmarkSnapshot]);

  const toggleCurrentBookmark = useCallback(() => {
    if (!bookId || !currentLocation || bookmarkBusy) return;
    markReaderActivity();
    setBookmarkBusy(true);
    requestBookmarkSnapshot('toggle');
  }, [bookId, bookmarkBusy, currentLocation, markReaderActivity, requestBookmarkSnapshot]);

  const handleBookmarkSnapshot = useCallback(async (
    requestId: number,
    snapshot: ReaderBookmarkSnapshot | null,
    message: string | null,
  ) => {
    const request = activeBookmarkSnapshotRequestRef.current;
    if (!request || request.id !== requestId) return;
    activeBookmarkSnapshotRequestRef.current = null;
    setBookmarkSnapshotRequest((current) => current?.id === requestId ? null : current);
    if (!snapshot || message) {
      if (message) console.warn('[BOOKMARK_SNAPSHOT_FAILED]', JSON.stringify({ requestId, message }));
      if (request.intent === 'toggle') setBookmarkBusy(false);
      return;
    }
    if (request.intent === 'status') {
      setCurrentBookmarked(snapshot.matchedBookmarkId !== null);
      const matched = snapshot.matchedBookmarkId === null
        ? null
        : bookmarks.find((bookmark) => bookmark.id === snapshot.matchedBookmarkId) ?? null;
      if (
        bookId
        && matched
        && snapshot.pageNumber !== null
        && snapshot.layoutSignature
        && (matched.pageNumber !== snapshot.pageNumber || matched.layoutSignature !== snapshot.layoutSignature)
      ) {
        await bookmarkRepository.updateLayoutPage(matched.id, bookId, snapshot.pageNumber, snapshot.layoutSignature);
        setBookmarks((current) => current.map((bookmark) => bookmark.id === matched.id
          ? { ...bookmark, pageNumber: snapshot.pageNumber, layoutSignature: snapshot.layoutSignature }
          : bookmark));
      }
      return;
    }
    if (!bookId) {
      setBookmarkBusy(false);
      return;
    }
    try {
      if (snapshot.matchedBookmarkId !== null) {
        await bookmarkRepository.remove(snapshot.matchedBookmarkId, bookId);
        setCurrentBookmarked(false);
      } else {
        await bookmarkRepository.create({
          bookId,
          cfi: snapshot.cfi,
          spineIndex: snapshot.spineIndex,
          sectionFraction: snapshot.sectionFraction,
          pageNumber: snapshot.pageNumber,
          layoutSignature: snapshot.layoutSignature,
          chapterTitle: snapshot.chapterTitle,
          excerpt: snapshot.excerpt,
        });
        setCurrentBookmarked(true);
      }
      setBookmarks(await bookmarkRepository.list(bookId));
    } catch (error) {
      console.warn('[BOOKMARK_TOGGLE_FAILED]', error);
    } finally {
      setBookmarkBusy(false);
    }
  }, [bookId, bookmarks]);

  return {
    bookmarks,
    bookmarksLoaded,
    bookmarkBusy,
    currentBookmarked,
    bookmarkSnapshotRequest,
    toggleCurrentBookmark,
    handleBookmarkSnapshot,
  };
}
