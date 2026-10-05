import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reportOperationError } from '../../../shared/operation-errors';
import { excerptRepository } from '../excerpt-repository';
import { highlightRepository, type ReaderHighlightSnapshotItem } from '../highlight-repository';
import type {
  ReaderExcerptVerificationRequest,
  ReaderSelectionActionEvent,
  ReaderSelectionCommand,
  ReaderSelectionPayload,
} from '../reader-types';

export const EXCERPT_ACTION_WIDTH = 72;
export const EXCERPT_ACTION_HEIGHT = 40;
export const EXCERPT_ACTION_EDGE_GAP = 12;
export const EXCERPT_ACTION_SELECTION_GAP = 10;

/**
 * ReaderScreen 巨型组件拆分：选中、高亮、笔记、摘录保存。
 *
 * 从 ReaderScreen 原样搬运：所有 state、ref、callback、memo 与依赖数组保持不变。
 * 交叉依赖显式作为参数传入：
 * - markReaderActivity：选中/高亮/摘录/原生菜单动作都算阅读活动。
 * - openSearch / requestInitialSearchQuery：选中后"在书中搜索"（useReaderSearch）。
 * - readerViewportWidth / readerViewportHeight / insets：摘录 action 按钮定位。
 */
export function useReaderSelection({
  bookId,
  markReaderActivity,
  openSearch,
  requestInitialSearchQuery,
  readerViewportWidth,
  readerViewportHeight,
  insets,
  isReady,
  settingsSheetPresented,
  highlightMenuBlocked,
}: {
  bookId: string | undefined;
  markReaderActivity: () => void;
  openSearch: () => void;
  requestInitialSearchQuery: (query: string) => void;
  readerViewportWidth: number;
  readerViewportHeight: number;
  insets: { top: number; bottom: number };
  isReady: boolean;
  settingsSheetPresented: boolean;
  highlightMenuBlocked: boolean;
}) {
  const [activeSelection, setActiveSelection] = useState<ReaderSelectionPayload | null>(null);
  const [excerptSaving, setExcerptSaving] = useState(false);
  const [selectionCommand, setSelectionCommand] = useState<ReaderSelectionCommand | null>(null);
  const [excerptVerificationRequest, setExcerptVerificationRequest] = useState<ReaderExcerptVerificationRequest | null>(null);
  const [highlightSnapshot, setHighlightSnapshot] = useState<ReaderHighlightSnapshotItem[] | null>(null);
  const [highlightMenuRequest, setHighlightMenuRequest] = useState<{ id: number; payload: ReaderSelectionPayload } | null>(null);
  const highlightMenuRequestRef = useRef<typeof highlightMenuRequest>(null);
  const highlightMenuSequenceRef = useRef(0);
  const highlightDeletesRef = useRef(new Set<string>());
  const activeSelectionRef = useRef<ReaderSelectionPayload | null>(null);
  const excerptActionPayloadRef = useRef<ReaderSelectionPayload | null>(null);
  const excerptActionPressingRef = useRef(false);
  const excerptSavingRef = useRef(false);
  const highlightSavingRef = useRef(false);
  const selectionCommandSequenceRef = useRef(0);
  const excerptVerificationSequenceRef = useRef(0);
  const currentBookIdRef = useRef(bookId);
  currentBookIdRef.current = bookId;

  // 换书时重置选中状态（原 ReaderScreen 内 bookId 重置 effect 的一部分）。
  useEffect(() => {
    activeSelectionRef.current = null;
    excerptActionPayloadRef.current = null;
    excerptActionPressingRef.current = false;
    excerptSavingRef.current = false;
    highlightSavingRef.current = false;
    setActiveSelection(null);
    setExcerptSaving(false);
    setSelectionCommand(null);
    setExcerptVerificationRequest(null);
    setHighlightSnapshot(null);
    highlightMenuRequestRef.current = null;
    setHighlightMenuRequest(null);
  }, [bookId]);

  const dismissHighlightMenu = useCallback(() => {
    highlightMenuRequestRef.current = null;
    setHighlightMenuRequest(null);
  }, []);

  useEffect(() => {
    if (highlightMenuBlocked) dismissHighlightMenu();
  }, [highlightMenuBlocked, dismissHighlightMenu]);

  const handleHighlightTap = useCallback((payload: ReaderSelectionPayload | null) => {
    if (!payload) {
      dismissHighlightMenu();
      return;
    }
    if (payload.bookId !== currentBookIdRef.current || highlightMenuBlocked) return;
    markReaderActivity();
    const request = { id: ++highlightMenuSequenceRef.current, payload };
    highlightMenuRequestRef.current = request;
    setHighlightMenuRequest(request);
  }, [dismissHighlightMenu, highlightMenuBlocked, markReaderActivity]);

  // 换书时加载高亮快照。
  useEffect(() => {
    if (!bookId) {
      setHighlightSnapshot(null);
      return undefined;
    }
    let active = true;
    void highlightRepository.listSnapshotForBook(bookId).then((items) => {
      if (!active) return;
      setHighlightSnapshot(items);
    }).catch((error: unknown) => {
      console.warn('[HIGHLIGHT_SNAPSHOT_LOAD_FAILED]', error);
      if (active) setHighlightSnapshot([]);
    });
    return () => { active = false; };
  }, [bookId]);

  // DEV 调试：就绪后预加载摘录做验证。
  useEffect(() => {
    if (!__DEV__ || !bookId || !isReady || settingsSheetPresented) return undefined;
    let active = true;
    void excerptRepository.listExcerptsForBook(bookId).then((excerpts) => {
      if (!active || excerpts.length === 0) return;
      setExcerptVerificationRequest({
        id: ++excerptVerificationSequenceRef.current,
        items: excerpts.slice(0, 3).map((excerpt) => ({
          excerptId: excerpt.id,
          text: excerpt.text,
          rangeCfi: excerpt.rangeCfi,
        })),
      });
    }).catch((error: unknown) => {
      console.warn('[EXCERPT_VERIFY_LOAD_FAILED]', error);
    });
    return () => { active = false; };
  }, [bookId, isReady, settingsSheetPresented]);

  const handleSelectionChange = useCallback(async (selection: ReaderSelectionPayload | null) => {
    // Touching the Native action may collapse WebKit's visual selection before
    // Pressable dispatches `onPress`. Keep the already-serialized payload
    // frozen until the repository write has either succeeded or failed.
    if (!selection && (excerptActionPressingRef.current || excerptSavingRef.current)) return;
    // A real selection gesture is reading activity; the clear path is covered
    // by the tap/page-turn signals that caused it.
    if (selection) markReaderActivity();
    activeSelectionRef.current = selection;
    if (selection) excerptActionPayloadRef.current = selection;
    setActiveSelection(selection);
  }, [markReaderActivity]);

  const freezeExcerptSelection = useCallback(() => {
    excerptActionPressingRef.current = true;
    excerptActionPayloadRef.current = activeSelectionRef.current ?? activeSelection;
  }, [activeSelection]);

  const releaseExcerptActionPress = useCallback(() => {
    requestAnimationFrame(() => {
      if (!excerptSavingRef.current) excerptActionPressingRef.current = false;
    });
  }, []);

  const createExcerptFromSelection = useCallback(async () => {
    const payload = excerptActionPayloadRef.current ?? activeSelectionRef.current;
    if (!payload || excerptSavingRef.current) return;
    markReaderActivity();
    excerptSavingRef.current = true;
    setExcerptSaving(true);
    try {
      const result = await excerptRepository.createExcerpt({
        bookId: payload.bookId,
        text: payload.text,
        startCfi: payload.startCfi,
        endCfi: payload.endCfi,
        rangeCfi: payload.rangeCfi,
        chapterTitle: payload.chapterTitle,
        sectionIndex: payload.sectionIndex,
      });
      // Re-read the row rather than verifying the caller's in-memory object.
      // This proves the SQLite round trip before selection is cleared.
      const persisted = await excerptRepository.getExcerptById(result.excerpt.id);
      if (!persisted) throw new Error('摘录保存后无法从数据库重新读取。');
      if (currentBookIdRef.current !== payload.bookId) return;
      setExcerptVerificationRequest({
        id: ++excerptVerificationSequenceRef.current,
        items: [{ excerptId: persisted.id, text: persisted.text, rangeCfi: persisted.rangeCfi }],
      });
      await Haptics.selectionAsync().catch(() => undefined);
      activeSelectionRef.current = null;
      excerptActionPayloadRef.current = null;
      setActiveSelection(null);
      setSelectionCommand({ id: ++selectionCommandSequenceRef.current, type: 'clear' });
    } catch (error) {
      if (__DEV__) console.error('[EXCERPT_CREATE_FAILED]', error);
      if (currentBookIdRef.current !== payload.bookId) return;
      reportOperationError(error, '摘录保存失败', '无法确认摘录已保存，请保留选区并重试。');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      if (currentBookIdRef.current === payload.bookId) {
        excerptSavingRef.current = false;
        excerptActionPressingRef.current = false;
        setExcerptSaving(false);
      }
    }
  }, [markReaderActivity]);

  const clearReaderSelection = useCallback(() => {
    dismissHighlightMenu();
    activeSelectionRef.current = null;
    excerptActionPayloadRef.current = null;
    setActiveSelection(null);
    setSelectionCommand({ id: ++selectionCommandSequenceRef.current, type: 'clear' });
  }, [dismissHighlightMenu]);

  const searchSelectionInBook = useCallback((payload: ReaderSelectionPayload) => {
    const query = payload.text.trim();
    if (!query) return;
    openSearch();
    requestInitialSearchQuery(query);
    clearReaderSelection();
  }, [clearReaderSelection, openSearch, requestInitialSearchQuery]);

  const onHighlightRequested = useCallback(async (payload: ReaderSelectionPayload) => {
    if (highlightSavingRef.current) return;
    markReaderActivity();
    highlightSavingRef.current = true;
    try {
      const result = await highlightRepository.createHighlight({
        bookId: payload.bookId,
        text: payload.text,
        startCfi: payload.startCfi,
        endCfi: payload.endCfi,
        rangeCfi: payload.rangeCfi,
        chapterTitle: payload.chapterTitle,
        sectionIndex: payload.sectionIndex,
        color: 'blue',
      });
      if (currentBookIdRef.current !== payload.bookId) return;
      // Paint even on a dedup hit: the adapter registry may have been rebuilt
      // since, and overlayer paint is idempotent for the same range CFI.
      const snapshotItem = { rangeCfi: result.highlight.rangeCfi, sectionIndex: result.highlight.sectionIndex };
      setHighlightSnapshot((prev) => {
        const next = (prev ?? []).filter((item) => item.rangeCfi !== snapshotItem.rangeCfi);
        next.push(snapshotItem);
        return next;
      });
      setSelectionCommand({
        id: ++selectionCommandSequenceRef.current,
        type: 'apply-highlight',
        rangeCfi: result.highlight.rangeCfi,
        sectionIndex: result.highlight.sectionIndex,
      });
      await Haptics.selectionAsync().catch(() => undefined);
      activeSelectionRef.current = null;
      excerptActionPayloadRef.current = null;
      setActiveSelection(null);
    } catch (error) {
      if (__DEV__) console.error('[HIGHLIGHT_CREATE_FAILED]', error);
      if (currentBookIdRef.current !== payload.bookId) return;
      reportOperationError(error, '高亮保存失败', '无法确认高亮已保存，请重试。');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      if (currentBookIdRef.current === payload.bookId) highlightSavingRef.current = false;
    }
  }, [markReaderActivity]);

  // The native destructive action dismisses immediately. Persist first so
  // a failed write leaves the existing highlight visible and recoverable.
  const deleteTappedHighlight = useCallback((payload: ReaderSelectionPayload) => {
    const { bookId: highlightedBookId, rangeCfi } = payload;
    const key = `${highlightedBookId}:${rangeCfi}`;
    if (highlightDeletesRef.current.has(key)) return;
    highlightDeletesRef.current.add(key);
    void highlightRepository.deleteHighlightByRange(highlightedBookId, rangeCfi).then(() => {
      if (currentBookIdRef.current !== highlightedBookId) return;
      setHighlightSnapshot((prev) => prev?.filter((item) => item.rangeCfi !== rangeCfi) ?? prev);
      setSelectionCommand({ id: ++selectionCommandSequenceRef.current, type: 'remove-highlight', rangeCfi });
    }).catch((error: unknown) => {
      if (currentBookIdRef.current !== highlightedBookId) return;
      reportOperationError(error, '删除高亮失败', '高亮仍然保留，请重试。');
      if (__DEV__) console.error('[HIGHLIGHT_DELETE_FAILED]', error);
    }).finally(() => { highlightDeletesRef.current.delete(key); });
  }, []);

  const onNoteRequested = useCallback((payload: ReaderSelectionPayload) => {
    if (__DEV__) console.log('[ANNOTATION_ACTION]', JSON.stringify({ action: 'note', rangeCfi: payload.rangeCfi, textLength: payload.text.length }));
  }, []);

  const handleNativeSelectionAction = useCallback((event: ReaderSelectionActionEvent) => {
    const { action, highlightRequestId } = event.nativeEvent;
    const request = highlightMenuRequestRef.current;
    const isHighlightAction = highlightRequestId !== undefined;
    if (isHighlightAction && (request?.id !== highlightRequestId || request.payload.bookId !== currentBookIdRef.current)) return;
    const payload = isHighlightAction ? request?.payload : excerptActionPayloadRef.current ?? activeSelectionRef.current;
    if (action === 'dismissHighlightMenu') {
      if (isHighlightAction) dismissHighlightMenu();
      return;
    }
    if (!payload) {
      if (__DEV__) console.warn('[ANNOTATION_ACTION_MISSING_SELECTION]', action);
      return;
    }
    // Any native selection action (excerpt / highlight / note / search-in-book)
    // is reading activity.
    markReaderActivity();
    if (isHighlightAction) dismissHighlightMenu();
    if (action === 'deleteHighlight') {
      if (isHighlightAction) deleteTappedHighlight(payload);
      return;
    }
    if (action === 'copy') return; // The native responder already used UIPasteboard.
    if (action === 'excerpt') {
      // Highlight taps carry their own payload; no DOM selection is needed.
      excerptActionPayloadRef.current = payload;
      void createExcerptFromSelection();
      return;
    }
    if (action === 'searchInBook') {
      searchSelectionInBook(payload);
      return;
    }
    // The note bridge contract stays a stub for the next Annotation Core phase;
    // highlight persistence above is real.
    if (action === 'highlight') {
      void onHighlightRequested(payload);
      return;
    }
    if (action === 'note') onNoteRequested(payload);
  }, [createExcerptFromSelection, deleteTappedHighlight, dismissHighlightMenu, markReaderActivity, onHighlightRequested, onNoteRequested, searchSelectionInBook]);

  const nativeHighlightMenuRequest = useMemo(() => highlightMenuRequest ? JSON.stringify({
    id: highlightMenuRequest.id,
    text: highlightMenuRequest.payload.text,
    rect: highlightMenuRequest.payload.rect,
  }) : '', [highlightMenuRequest]);

  const excerptActionPosition = useMemo(() => {
    if (!activeSelection) return null;
    const left = Math.min(
      readerViewportWidth - EXCERPT_ACTION_WIDTH - EXCERPT_ACTION_EDGE_GAP,
      Math.max(EXCERPT_ACTION_EDGE_GAP, activeSelection.rect.x + activeSelection.rect.width / 2 - EXCERPT_ACTION_WIDTH / 2),
    );
    // WebKit owns the system edit menu above the selection. Keep the app's
    // single supplemental action below it, falling back above near the bottom.
    const below = activeSelection.rect.y + activeSelection.rect.height + EXCERPT_ACTION_SELECTION_GAP;
    const maximumTop = readerViewportHeight - insets.bottom - EXCERPT_ACTION_HEIGHT - EXCERPT_ACTION_EDGE_GAP;
    const top = below <= maximumTop
      ? below
      : Math.max(insets.top + EXCERPT_ACTION_EDGE_GAP, activeSelection.rect.y - EXCERPT_ACTION_HEIGHT - EXCERPT_ACTION_SELECTION_GAP);
    return { left, top };
  }, [activeSelection, insets.bottom, insets.top, readerViewportHeight, readerViewportWidth]);

  return {
    activeSelection,
    excerptSaving,
    selectionCommand,
    excerptVerificationRequest,
    highlightSnapshot,
    handleSelectionChange,
    clearReaderSelection,
    searchSelectionInBook,
    onHighlightRequested,
    handleHighlightTap,
    nativeHighlightMenuRequest,
    onNoteRequested,
    handleNativeSelectionAction,
    freezeExcerptSelection,
    releaseExcerptActionPress,
    createExcerptFromSelection,
    excerptActionPosition,
  };
}
