import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { excerptRepository } from '../excerpt-repository';
import { highlightRepository, type ReaderHighlightSnapshotItem } from '../highlight-repository';
import type {
  FootnoteAnchorRect,
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
 * 笔记弹窗状态：
 * - create：从选词菜单「添加笔记」进入，payload 是选中的文字；
 * - view：点按带笔记的高亮进入，只读展示；
 * - edit：从 view 切换到编辑。
 */
export type ReaderNotePopoverState =
  | { mode: 'create'; payload: ReaderSelectionPayload }
  | { mode: 'view' | 'edit'; rangeCfi: string; sectionIndex: number; note: string; anchor: FootnoteAnchorRect };

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
}) {
  const [activeSelection, setActiveSelection] = useState<ReaderSelectionPayload | null>(null);
  const [excerptSaving, setExcerptSaving] = useState(false);
  const [selectionCommand, setSelectionCommand] = useState<ReaderSelectionCommand | null>(null);
  const [excerptVerificationRequest, setExcerptVerificationRequest] = useState<ReaderExcerptVerificationRequest | null>(null);
  const [highlightSnapshot, setHighlightSnapshot] = useState<ReaderHighlightSnapshotItem[] | null>(null);
  const [notePopover, setNotePopover] = useState<ReaderNotePopoverState | null>(null);
  const activeSelectionRef = useRef<ReaderSelectionPayload | null>(null);
  const excerptActionPayloadRef = useRef<ReaderSelectionPayload | null>(null);
  const excerptActionPressingRef = useRef(false);
  const excerptSavingRef = useRef(false);
  const highlightSavingRef = useRef(false);
  const noteSavingRef = useRef(false);
  const selectionCommandSequenceRef = useRef(0);
  const excerptVerificationSequenceRef = useRef(0);

  // 换书时重置选中状态（原 ReaderScreen 内 bookId 重置 effect 的一部分）。
  useEffect(() => {
    activeSelectionRef.current = null;
    excerptActionPayloadRef.current = null;
    excerptActionPressingRef.current = false;
    excerptSavingRef.current = false;
    setActiveSelection(null);
    setExcerptSaving(false);
    setSelectionCommand(null);
    setExcerptVerificationRequest(null);
    setHighlightSnapshot(null);
    setNotePopover(null);
  }, [bookId]);

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
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      excerptSavingRef.current = false;
      excerptActionPressingRef.current = false;
      setExcerptSaving(false);
    }
  }, [markReaderActivity]);

  const clearReaderSelection = useCallback(() => {
    activeSelectionRef.current = null;
    excerptActionPayloadRef.current = null;
    setActiveSelection(null);
    setSelectionCommand({ id: ++selectionCommandSequenceRef.current, type: 'clear' });
  }, []);

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
        note: null,
      });
      // Paint even on a dedup hit: the adapter registry may have been rebuilt
      // since, and overlayer paint is idempotent for the same range CFI.
      const snapshotItem: ReaderHighlightSnapshotItem = {
        rangeCfi: result.highlight.rangeCfi,
        sectionIndex: result.highlight.sectionIndex,
        hasNote: result.highlight.note != null && result.highlight.note !== '',
      };
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
        hasNote: result.highlight.note != null && result.highlight.note !== '',
      });
      await Haptics.selectionAsync().catch(() => undefined);
      activeSelectionRef.current = null;
      excerptActionPayloadRef.current = null;
      setActiveSelection(null);
    } catch (error) {
      if (__DEV__) console.error('[HIGHLIGHT_CREATE_FAILED]', error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      highlightSavingRef.current = false;
    }
  }, [markReaderActivity]);

  // Fired by the adapter after it already removed the paint for a tapped
  // highlight (delete bubble), or by the note popover delete action (paint
  // still on screen — the remove-highlight command clears it). Only the
  // SQLite row and the RN-side snapshot remain.
  const handleHighlightDeleteRequest = useCallback((rangeCfi: string) => {
    if (!bookId) return;
    setHighlightSnapshot((prev) => prev?.filter((item) => item.rangeCfi !== rangeCfi) ?? prev);
    setSelectionCommand({
      id: ++selectionCommandSequenceRef.current,
      type: 'remove-highlight',
      rangeCfi,
    });
    void highlightRepository.deleteHighlightByRange(bookId, rangeCfi).catch((error: unknown) => {
      if (__DEV__) console.error('[HIGHLIGHT_DELETE_FAILED]', error);
    });
  }, [bookId]);

  // 选中后点「添加笔记」：打开笔记编辑器（create 模式），保存时才建高亮。
  const onNoteRequested = useCallback((payload: ReaderSelectionPayload) => {
    markReaderActivity();
    setNotePopover({ mode: 'create', payload });
  }, [markReaderActivity]);

  const closeNotePopover = useCallback(() => {
    setNotePopover(null);
  }, []);

  // view → edit：保留 rangeCfi/sectionIndex/anchor，只切模式。
  const startEditNote = useCallback(() => {
    setNotePopover((prev) => prev && prev.mode === 'view'
      ? { mode: 'edit', rangeCfi: prev.rangeCfi, sectionIndex: prev.sectionIndex, note: prev.note, anchor: prev.anchor }
      : prev);
  }, []);

  // 点按带笔记的高亮：读 DB 拿笔记，打开 view 模式。DB 里没笔记（竞态）
  // 就什么都不做——点按已经消费掉了，不会翻页。
  const handleHighlightNoteTap = useCallback(async (rangeCfi: string, anchor: FootnoteAnchorRect) => {
    if (!bookId) return;
    markReaderActivity();
    try {
      const highlight = await highlightRepository.findByRange(bookId, rangeCfi);
      const note = highlight?.note?.trim();
      if (!note || !highlight) return;
      setNotePopover({ mode: 'view', rangeCfi, sectionIndex: highlight.sectionIndex, note, anchor });
    } catch (error) {
      if (__DEV__) console.error('[NOTE_OPEN_FAILED]', error);
    }
  }, [bookId, markReaderActivity]);

  // 高亮建好/更新后：同步 RN 快照（hasNote 决定下次点按走弹窗还是删除气泡）
  // 并下发 paint 命令。paint 是幂等的，重复下发无害。
  const syncHighlightPaint = useCallback((rangeCfi: string, sectionIndex: number, hasNote: boolean) => {
    const snapshotItem: ReaderHighlightSnapshotItem = { rangeCfi, sectionIndex, hasNote };
    setHighlightSnapshot((prev) => {
      const next = (prev ?? []).filter((item) => item.rangeCfi !== snapshotItem.rangeCfi);
      next.push(snapshotItem);
      return next;
    });
    setSelectionCommand({
      id: ++selectionCommandSequenceRef.current,
      type: 'apply-highlight',
      rangeCfi,
      sectionIndex,
      hasNote,
    });
  }, []);

  // 保存笔记。create：建高亮（已存在则把笔记附上去）；edit：更新笔记，
  // 清空则删掉笔记（高亮保留）。
  const saveNote = useCallback(async (text: string) => {
    const state = notePopover;
    if (!state || noteSavingRef.current) return;
    const trimmed = text.trim();
    noteSavingRef.current = true;
    try {
      if (state.mode === 'create') {
        if (!trimmed) {
          setNotePopover(null);
          return;
        }
        const payload = state.payload;
        const result = await highlightRepository.createHighlight({
          bookId: payload.bookId,
          text: payload.text,
          startCfi: payload.startCfi,
          endCfi: payload.endCfi,
          rangeCfi: payload.rangeCfi,
          chapterTitle: payload.chapterTitle,
          sectionIndex: payload.sectionIndex,
          color: 'blue',
          note: trimmed,
        });
        let finalNote = result.highlight.note;
        if (!result.created) {
          // 该范围已有高亮：把笔记附到已有的高亮上。
          finalNote = await highlightRepository.updateHighlightNote(payload.bookId, payload.rangeCfi, trimmed);
        }
        syncHighlightPaint(payload.rangeCfi, payload.sectionIndex, finalNote != null && finalNote !== '');
        await Haptics.selectionAsync().catch(() => undefined);
        activeSelectionRef.current = null;
        excerptActionPayloadRef.current = null;
        setActiveSelection(null);
      } else if (state.mode === 'edit') {
        if (!bookId) return;
        const finalNote = await highlightRepository.updateHighlightNote(bookId, state.rangeCfi, trimmed || null);
        syncHighlightPaint(state.rangeCfi, state.sectionIndex, finalNote != null && finalNote !== '');
        if (finalNote) {
          setNotePopover({ mode: 'view', rangeCfi: state.rangeCfi, sectionIndex: state.sectionIndex, note: finalNote, anchor: state.anchor });
        } else {
          setNotePopover(null);
        }
      }
    } catch (error) {
      if (__DEV__) console.error('[NOTE_SAVE_FAILED]', error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      noteSavingRef.current = false;
    }
  }, [bookId, syncHighlightPaint]);

  // view 模式删除：整条高亮（含笔记）删掉，和无笔记高亮的删除气泡语义一致。
  const deleteNoteHighlight = useCallback(async () => {
    const state = notePopover;
    if (!state || state.mode === 'create' || !bookId) return;
    setNotePopover(null);
    handleHighlightDeleteRequest(state.rangeCfi);
  }, [notePopover, bookId, handleHighlightDeleteRequest]);

  const handleNativeSelectionAction = useCallback((event: ReaderSelectionActionEvent) => {
    const action = event.nativeEvent.action;
    const payload = excerptActionPayloadRef.current ?? activeSelectionRef.current;
    if (!payload) {
      if (__DEV__) console.warn('[ANNOTATION_ACTION_MISSING_SELECTION]', action);
      return;
    }
    // Any native selection action (excerpt / highlight / note / search-in-book)
    // is reading activity.
    markReaderActivity();
    if (action === 'excerpt') {
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
  }, [createExcerptFromSelection, markReaderActivity, onHighlightRequested, onNoteRequested, searchSelectionInBook]);

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
    notePopover,
    notePopoverOpen: notePopover != null,
    handleSelectionChange,
    clearReaderSelection,
    searchSelectionInBook,
    onHighlightRequested,
    handleHighlightDeleteRequest,
    handleHighlightNoteTap,
    onNoteRequested,
    saveNote,
    closeNotePopover,
    startEditNote,
    deleteNoteHighlight,
    handleNativeSelectionAction,
    freezeExcerptSelection,
    releaseExcerptActionPress,
    createExcerptFromSelection,
    excerptActionPosition,
  };
}
