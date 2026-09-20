import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SFSymbol } from 'sf-symbols-typescript';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  Extrapolation,
  LinearTransition,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '../../design-system/tokens';
import { readerSettingsRepository } from '../reader/reader-settings-repository';
import { BookCoverArt } from './BookCoverArt';

const LIBRARY_HEADER_SAFE_TOP_GAP = 2;
import { bookRepository } from './book-repository';
import { beginReaderOpen } from '../reader/reader-open-performance';
import { preloadReaderData } from '../reader/reader-preload';
import {
  importPickedEpubs,
  removeBooks as removeStoredBooks,
  replaceBookCover,
  restoreOriginalBookMetadata,
  shareBook,
  updateBookMetadata,
  updateBookReadingStatus,
} from './library-import-service';
import type { Book, ReadingStatus } from './library-types';
import { useLibraryView } from './library-view-context';

type SortMode = 'manual' | 'recentlyRead' | 'recentlyAdded' | 'title' | 'author';
type FilterMode = 'all' | ReadingStatus;
type LibraryBook = Book & { lastReadAt?: string; progress: number | null; state: ReadingStatus };
type BookMenuHandlers = {
  onEditCover: (book: LibraryBook) => void;
  onEditTitle: (book: LibraryBook) => void;
  onEditAuthor: (book: LibraryBook) => void;
  onRestoreOriginal: (book: LibraryBook) => void;
  onRemove: () => void;
  onShare: (book: LibraryBook) => void;
  onToggleFinished: (book: LibraryBook) => void;
};

type ReaderOpeningFrame = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type ReaderOpeningTransition = {
  backgroundColor: string;
  book: LibraryBook;
  frame: ReaderOpeningFrame;
  id: number;
  target: ReaderOpeningFrame;
};

function ReaderOpeningTransitionOverlay({
  onFinished,
  transition,
}: {
  onFinished: (transition: ReaderOpeningTransition) => void;
  transition: ReaderOpeningTransition;
}) {
  // This value belongs to one overlay mount only. A new opening never sees
  // the previous cover's completed value or native animated node.
  const progress = useSharedValue(0);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.72, 1], [0, 0.96, 1], Extrapolation.CLAMP),
  }));
  const coverStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.get(), [0, 1], [transition.frame.height, transition.target.height]),
    left: interpolate(progress.get(), [0, 1], [transition.frame.x, transition.target.x]),
    top: interpolate(progress.get(), [0, 1], [transition.frame.y, transition.target.y]),
    width: interpolate(progress.get(), [0, 1], [transition.frame.width, transition.target.width]),
  }));

  useEffect(() => {
    if (__DEV__) console.log('[OPEN_TRANSITION_OVERLAY_MOUNT]', JSON.stringify({ id: transition.id }));
    const frame = requestAnimationFrame(() => {
      progress.set(withTiming(1, {
        duration: 460,
        easing: Easing.inOut(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }, (finished) => {
        if (finished) runOnJS(onFinished)(transition);
      }));
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimation(progress);
    };
  }, [onFinished, progress, transition]);

  return (
    <View pointerEvents="auto" style={[StyleSheet.absoluteFill, styles.readerOpeningTransition]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: transition.backgroundColor, opacity: 0 },
          backdropStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.readerOpeningCover,
          {
            backgroundColor: tokens.coverTones[transition.book.coverTone],
            // The non-animated fallback is deliberately the source rectangle.
            // If the native animated style attaches one frame late, there is
            // still no possible frame where this cover appears at the target.
            height: transition.frame.height,
            left: transition.frame.x,
            top: transition.frame.y,
            width: transition.frame.width,
          },
          coverStyle,
        ]}
      >
        <BookCoverArt
          author={transition.book.author}
          coverTone={transition.book.coverTone}
          coverUri={transition.book.coverUri}
          hasGeneratedCover={transition.book.hasGeneratedCover}
          title={transition.book.title}
        />
      </Animated.View>
    </View>
  );
}

const layoutTransition = LinearTransition.duration(tokens.animation.layoutDuration).reduceMotion(
  ReduceMotion.System,
);
const reorderLayoutTransition = LinearTransition.duration(300)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
const displayModeTransition = LinearTransition.duration(340)
  .easing(Easing.inOut(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
const selectionTransitionDuration = 280;

const sortLabels: Record<SortMode, string> = {
  manual: '手动',
  recentlyRead: '最近阅读',
  recentlyAdded: '最近添加',
  title: '书名',
  author: '作者',
};

const filterLabels: Record<FilterMode, string> = {
  all: '全部',
  reading: '阅读中',
  unread: '未开始',
  finished: '已读完',
};

function toLibraryBook(book: Book): LibraryBook {
  return { ...book, lastReadAt: book.lastOpenedAt ?? undefined, progress: book.readingProgress, state: book.readingStatus };
}

function displayProgress(book: LibraryBook) {
  return book.progress === null ? null : Math.round(book.progress * 100);
}

export default function LibraryScreen() {
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollOffset = useSharedValue(0);
  const selectionUiProgress = useSharedValue(0);
  const { displayMode, setTabBarHidden } = useLibraryView();
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionExitPending, setSelectionExitPending] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [manualOrderSnapshot, setManualOrderSnapshot] = useState<LibraryBook[] | null>(null);
  const [manualOrderingMode, setManualOrderingMode] = useState(false);
  const [readerBackgroundColor, setReaderBackgroundColor] = useState<string>(tokens.colors.background);
  const [readerOpeningTransition, setReaderOpeningTransition] = useState<ReaderOpeningTransition | null>(null);
  // Import progress ring: 0..1 while an import is running, null when idle.
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const selectionExitTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerOpeningPendingRef = useRef(false);
  const readerOpeningSequenceRef = useRef(0);
  const transitionTeardownTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeHeaderVisible = false;

  const reloadBooks = useCallback(async () => {
    const persistedBooks = await bookRepository.getAllBooks();
    setBooks(persistedBooks.map(toLibraryBook));
    setLibraryReady(true);
  }, []);

  useEffect(() => {
    void reloadBooks().catch(() => setLibraryReady(true));
  }, [reloadBooks]);

  useFocusEffect(useCallback(() => {
    setReaderOpeningTransition(null);
    readerOpeningPendingRef.current = false;
    setTabBarHidden(false);
    void reloadBooks().catch(() => setLibraryReady(true));
    void readerSettingsRepository.get().then((settings) => {
      setReaderBackgroundColor(settings.appearance === 'dark' ? '#151517' : tokens.colors.background);
    }).catch(() => setReaderBackgroundColor(tokens.colors.background));
  }, [reloadBooks, setTabBarHidden]));

  const finishReaderOpeningTransition = useCallback((transition: ReaderOpeningTransition) => {
    if (__DEV__) console.log('[OPEN_TRANSITION_FINISH]', JSON.stringify({ id: transition.id, bookId: transition.book.id }));
    router.push({
      pathname: '/reader/[bookId]',
      params: {
        bookId: transition.book.id,
        openingAuthor: transition.book.author ?? '',
        openingBackground: transition.backgroundColor,
        openingCoverTone: transition.book.coverTone,
        openingCoverUri: transition.book.coverUri ?? '',
        openingGenerated: transition.book.hasGeneratedCover ? '1' : '0',
        openingTitle: transition.book.title,
      },
    });
    // The Library route remains mounted behind Reader. Keep the completed
    // overlay up until this screen blurs (the reader is painted on top by
    // then); tearing it down here would flash the library grid in the gap
    // before the reader's first paint. The overlay's final frame is
    // pixel-identical to the reader's launch cover, so holding it is invisible.
    // Fallback: if navigation never happens, don't leave the user stuck.
    if (transitionTeardownTimeout.current) clearTimeout(transitionTeardownTimeout.current);
    transitionTeardownTimeout.current = setTimeout(() => {
      if (__DEV__) console.log('[OPEN_TRANSITION_FALLBACK_TIMEOUT]', JSON.stringify({ id: transition.id }));
      setReaderOpeningTransition(null);
      readerOpeningPendingRef.current = false;
    }, 2000);
  }, [router]);

  // Tear down a completed opening transition once the reader has taken over.
  // NOTE: blur fires when navigation completes, which can be BEFORE the
  // reader's first paint. Tearing down immediately exposes the library grid
  // for a few frames (perceived as a "flash" or "animation replay"). Hold the
  // overlay briefly after blur; it's invisible behind the opaque reader.
  useFocusEffect(useCallback(() => {
    if (transitionTeardownTimeout.current) {
      clearTimeout(transitionTeardownTimeout.current);
      transitionTeardownTimeout.current = null;
    }
    return () => {
      if (__DEV__) console.log('[OPEN_TRANSITION_BLUR_CLEANUP]');
      if (transitionTeardownTimeout.current) {
        clearTimeout(transitionTeardownTimeout.current);
        transitionTeardownTimeout.current = null;
      }
      transitionTeardownTimeout.current = setTimeout(() => {
        transitionTeardownTimeout.current = null;
        setReaderOpeningTransition(null);
        readerOpeningPendingRef.current = false;
      }, 1000);
    };
  }, []));

  const openReaderWithTransition = useCallback((book: LibraryBook, frame: ReaderOpeningFrame) => {
    if (__DEV__) console.log('[OPEN_TRANSITION_OPEN]', JSON.stringify({ bookId: book.id, pending: readerOpeningPendingRef.current, hasTransition: Boolean(readerOpeningTransition) }));
    if (readerOpeningPendingRef.current || readerOpeningTransition) return;
    readerOpeningPendingRef.current = true;
    beginReaderOpen(book.id, book.fileSize);
    // Start the expensive reader data load now so it runs in parallel with
    // the cover opening animation; the reader picks it up on mount.
    preloadReaderData(book.id);
    setTabBarHidden(true);
    const targetWidth = Math.min(240, width * 0.65);
    const targetHeight = targetWidth / tokens.cover.gridAspectRatio;
    const transition: ReaderOpeningTransition = {
      backgroundColor: readerBackgroundColor,
      book,
      frame,
      id: ++readerOpeningSequenceRef.current,
      target: {
        height: targetHeight,
        width: targetWidth,
        x: (width - targetWidth) / 2,
        y: (height - targetHeight) / 2,
      },
    };
    setReaderOpeningTransition(transition);
  }, [height, readerBackgroundColor, readerOpeningTransition, setTabBarHidden, width]);

  const gridItemWidth = Math.max(0, (width - tokens.spacing.screen * 2 - tokens.spacing.grid) / 2);
  const selectedBookSet = useMemo(() => new Set(selectedBookIds), [selectedBookIds]);
  const isAllSelected = books.length > 0 && selectedBookIds.length === books.length;
  useEffect(() => () => {
    if (selectionExitTimeout.current) clearTimeout(selectionExitTimeout.current);
    if (transitionTeardownTimeout.current) clearTimeout(transitionTeardownTimeout.current);
  }, []);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollOffset.set(event.contentOffset.y);
  });
  const floatingTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollOffset.get(), [0, 8, 22, 42], [1, 0.82, 0.12, 0], Extrapolation.CLAMP),
  }));
  const selectionAllTransitionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(selectionUiProgress.get(), [0, 1], [14, 0], Extrapolation.CLAMP) },
      { scale: interpolate(selectionUiProgress.get(), [0, 1], [0.9, 1], Extrapolation.CLAMP) },
    ],
  }));
  const selectionDoneTransitionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(selectionUiProgress.get(), [0, 1], [-8, 0], Extrapolation.CLAMP) },
      { scale: interpolate(selectionUiProgress.get(), [0, 1], [0.88, 1], Extrapolation.CLAMP) },
    ],
  }));
  const selectionBottomTransitionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(selectionUiProgress.get(), [0, 1], [22, 0], Extrapolation.CLAMP) },
      { scale: interpolate(selectionUiProgress.get(), [0, 1], [0.9, 1], Extrapolation.CLAMP) },
    ],
  }));

  const visibleBooks = useMemo(() => {
    const filtered = filterMode === 'all' ? books : books.filter((book) => book.state === filterMode);
    const sorted = [...filtered];

    switch (sortMode) {
      case 'recentlyRead':
        return sorted.sort(
          (left, right) => new Date(right.lastReadAt ?? 0).getTime() - new Date(left.lastReadAt ?? 0).getTime(),
        );
      case 'recentlyAdded':
        return sorted.sort((left, right) => new Date(right.addedAt).getTime() - new Date(left.addedAt).getTime());
      case 'title':
        return sorted.sort((left, right) => left.title.localeCompare(right.title, 'zh-Hans-CN'));
      case 'author':
        return sorted.sort((left, right) => (left.author ?? '').localeCompare(right.author ?? '', 'zh-Hans-CN'));
      case 'manual':
      default:
        return sorted;
    }
  }, [books, filterMode, sortMode]);

  const continueReadingBook = useMemo(
    () =>
      books
        .filter((book) => book.state === 'reading' && book.lastReadAt && book.progress !== null)
        .sort(
          (left, right) => new Date(right.lastReadAt ?? 0).getTime() - new Date(left.lastReadAt ?? 0).getTime(),
        )[0],
    [books],
  );

  const toggleFinished = useCallback(
    (book: LibraryBook) => {
      const nextStatus: ReadingStatus = book.state === 'finished' ? 'unread' : 'finished';
      void updateBookReadingStatus(book, nextStatus).then(reloadBooks).catch(() => undefined);
    },
    [reloadBooks],
  );

  const renameBook = useCallback(
    (book: LibraryBook) => {
      Alert.prompt(
        '编辑书名',
        undefined,
        (title) => {
          const trimmedTitle = title.trim();
          if (trimmedTitle) {
            void updateBookMetadata(book.id, { title: trimmedTitle, author: book.author, coverUri: book.coverUri }).then(reloadBooks).catch(() => undefined);
          }
        },
        'plain-text',
        book.title,
      );
    },
    [reloadBooks],
  );

  const renameBookAuthor = useCallback(
    (book: LibraryBook) => {
      Alert.prompt(
        '编辑作者',
        undefined,
        (author) => {
          const trimmedAuthor = author.trim();
          void updateBookMetadata(book.id, { title: book.title, author: trimmedAuthor || null, coverUri: book.coverUri }).then(reloadBooks).catch(() => undefined);
        },
        'plain-text',
        book.author ?? '',
      );
    },
    [reloadBooks],
  );

  const removeBooks = useCallback((bookIds: string[]) => {
    if (bookIds.length === 0) {
      return;
    }
    Alert.alert(
      bookIds.length === 1 ? '移除图书？' : `移除这 ${bookIds.length} 本图书？`,
      '移除后会删除本机保存的 EPUB 和封面。',
      [
        { style: 'cancel', text: '取消' },
        {
          style: 'destructive',
          text: '移除',
          onPress: () => {
            void removeStoredBooks(bookIds).then(async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
              setSelectedBookIds((currentIds) => currentIds.filter((bookId) => !bookIds.includes(bookId)));
              await reloadBooks();
            }).catch(() => undefined);
          },
        },
      ],
    );
  }, [reloadBooks]);

  const confirmDuplicateImport = useCallback((duplicate: { existingBook: Book }) => (
    new Promise<boolean>((resolve) => {
      Alert.alert(
        '这本书已经在书库中',
        `《${duplicate.existingBook.title}》`,
        [
          { style: 'cancel', text: '取消', onPress: () => resolve(false) },
          { text: '再次导入', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    })
  ), []);

  const importBooks = useCallback(() => {
    // Ring progress: 0..1 while importing, null when idle. The first
    // onProgress fires right after files are picked (the iOS system picker
    // reports no progress of its own). Cleared on every exit path (done,
    // canceled, error) so the ring never gets stuck.
    void importPickedEpubs(
      confirmDuplicateImport,
      (progress) => setImportProgress(progress.fraction),
    ).then(async (summary) => {
      setImportProgress(null);
      if (!summary) return;
      await reloadBooks();
      if (summary.failures.length > 0) {
        const lines = [
          summary.imported.length > 0 ? `已导入 ${summary.imported.length} 本图书` : null,
          summary.failures.length > 0 ? `${summary.failures.length} 本无法读取` : null,
        ].filter(Boolean);
        Alert.alert('导入结果', lines.join('\n'));
      }
    }).catch(() => setImportProgress(null));
  }, [confirmDuplicateImport, reloadBooks]);

  const shareSelectedBooks = useCallback(() => {
    if (selectedBookIds.length === 0) return;
    if (selectedBookIds.length > 1) {
      Alert.alert('批量分享', '当前 iOS 系统分享接口一次只能可靠地分享一本 EPUB。请选择一本图书后再分享。');
      return;
    }
    const book = books.find((item) => item.id === selectedBookIds[0]);
    if (book) void shareBook(book).catch(() => undefined);
  }, [books, selectedBookIds]);

  const toggleBookSelection = useCallback((bookId: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    setSelectedBookIds((currentIds) =>
      currentIds.includes(bookId)
        ? currentIds.filter((currentBookId) => currentBookId !== bookId)
        : [...currentIds, bookId],
    );
  }, []);

  const exitSelectionMode = useCallback(() => {
    if (selectionExitPending) return;
    setSelectionExitPending(true);
    setTabBarHidden(false);
    selectionUiProgress.set(withTiming(0, { duration: selectionTransitionDuration }));
    if (selectionExitTimeout.current) clearTimeout(selectionExitTimeout.current);
    selectionExitTimeout.current = setTimeout(() => {
      setSelectedBookIds([]);
      setSelectionExitPending(false);
      setSelectionMode(false);
      setTabBarHidden(false);
      selectionExitTimeout.current = null;
    }, selectionTransitionDuration + 10);
  }, [selectionExitPending, selectionUiProgress, setTabBarHidden]);

  const enterSelectionMode = useCallback(() => {
    if (selectionExitTimeout.current) clearTimeout(selectionExitTimeout.current);
    selectionExitTimeout.current = null;
    setSelectionExitPending(false);
    setSelectionMode(true);
    setTabBarHidden(true);
    selectionUiProgress.set(withTiming(1, { duration: selectionTransitionDuration }));
  }, [selectionUiProgress, setTabBarHidden]);

  const toggleAllBooks = useCallback(() => {
    Haptics.selectionAsync().catch(() => undefined);
    setSelectedBookIds(isAllSelected ? [] : books.map((book) => book.id));
  }, [books, isAllSelected]);

  const selectionDeleteActions: MenuAction[] = selectedBookIds.length > 0
    ? [
        { id: 'remove-selected', title: '移除所选图书', image: 'trash' as SFSymbol, attributes: { destructive: true } },
        { id: 'remove-all', title: '全部删除', image: 'trash.fill' as SFSymbol, attributes: { destructive: true } },
      ]
    : [];

  const handleSelectionDeleteAction = useCallback((actionId: string) => {
    if (actionId === 'remove-selected') {
      removeBooks(selectedBookIds);
    } else if (actionId === 'remove-all') {
      removeBooks(books.map((book) => book.id));
    }
  }, [books, removeBooks, selectedBookIds]);

  const enterManualOrderingMode = useCallback(() => {
    if (manualOrderingMode) return;
    // The stored array is always the manual order; the active sort only changes
    // the derived view. Switching both states in this event avoids an interim
    // frame where the grid is rendered in two different orders.
    setManualOrderSnapshot([...books]);
    setSortMode('manual');
    setManualOrderingMode(true);
    setTabBarHidden(true);
  }, [books, manualOrderingMode, setTabBarHidden]);

  const cancelManualOrdering = useCallback(() => {
    if (manualOrderSnapshot) {
      setBooks(manualOrderSnapshot);
    }
    setManualOrderSnapshot(null);
    setManualOrderingMode(false);
    setTabBarHidden(false);
  }, [manualOrderSnapshot, setTabBarHidden]);

  const finishManualOrdering = useCallback(() => {
    setManualOrderSnapshot(null);
    setManualOrderingMode(false);
    setTabBarHidden(false);
    void bookRepository.updateManualOrder(books.map((book) => book.id)).catch(() => undefined);
  }, [books, setTabBarHidden]);

  const notifyManualReorder = useCallback(() => {
    Haptics.selectionAsync().catch(() => undefined);
  }, []);

  const moveManualBook = useCallback((bookId: string, targetIndex: number) => {
    setBooks((currentBooks) => {
      const currentVisibleBooks = filterMode === 'all'
        ? currentBooks
        : currentBooks.filter((book) => book.state === filterMode);
      const sourceIndex = currentVisibleBooks.findIndex((book) => book.id === bookId);
      const clampedTargetIndex = Math.max(0, Math.min(targetIndex, currentVisibleBooks.length - 1));

      if (sourceIndex < 0 || sourceIndex === clampedTargetIndex) {
        return currentBooks;
      }

      const reorderedVisibleBooks = [...currentVisibleBooks];
      const [movedBook] = reorderedVisibleBooks.splice(sourceIndex, 1);
      reorderedVisibleBooks.splice(clampedTargetIndex, 0, movedBook);

      if (filterMode === 'all') {
        return reorderedVisibleBooks;
      }

      const reorderedBookIds = new Set(reorderedVisibleBooks.map((book) => book.id));
      let visibleBookIndex = 0;
      return currentBooks.map((book) => (
        reorderedBookIds.has(book.id) ? reorderedVisibleBooks[visibleBookIndex++] : book
      ));
    });
  }, [filterMode]);

  const chooseSortMode = useCallback(
    (nextSortMode: SortMode) => {
      setSortMode(nextSortMode);
      if (nextSortMode === 'manual') {
        enterManualOrderingMode();
      }
    },
    [enterManualOrderingMode],
  );

  const renderBook = (book: LibraryBook) => {
    const isSelected = selectedBookSet.has(book.id);
    const canOpenReader = !selectionMode && !selectionExitPending && !manualOrderingMode;
    const onOpenReader = canOpenReader
      ? (frame: ReaderOpeningFrame) => openReaderWithTransition(book, frame)
      : undefined;
    const titleMenu: BookMenuHandlers | undefined = !manualOrderingMode
      ? {
          onEditCover: (targetBook) => {
            void replaceBookCover(targetBook).then((coverUri) => {
              if (coverUri) return reloadBooks();
              return undefined;
            }).catch(() => undefined);
          },
          onEditTitle: renameBook,
          onEditAuthor: renameBookAuthor,
          onRestoreOriginal: (targetBook) => {
            void restoreOriginalBookMetadata(targetBook.id).then(reloadBooks).catch(() => undefined);
          },
          onRemove: () => removeBooks([book.id]),
          onShare: (targetBook) => { void shareBook(targetBook).catch(() => undefined); },
          onToggleFinished: toggleFinished,
        }
      : undefined;
    const bookContent = displayMode === 'grid'
      ? <GridBook book={book} manualOrdering={manualOrderingMode} onOpenReader={onOpenReader} opening={readerOpeningTransition?.book.id === book.id} titleMenu={titleMenu} width={gridItemWidth} selected={selectionMode && isSelected && !selectionExitPending} selectionMode={false} />
      : <ListBook book={book} manualOrdering={manualOrderingMode} onOpenReader={onOpenReader} opening={readerOpeningTransition?.book.id === book.id} titleMenu={titleMenu} selected={false} selectionMode={false} />;

    if (manualOrderingMode) {
      return (
        <ReorderableBook
          bookId={book.id}
          content={bookContent}
          displayMode={displayMode}
          index={visibleBooks.findIndex((visibleBook) => visibleBook.id === book.id)}
          key={book.id}
          totalBooks={visibleBooks.length}
          width={gridItemWidth}
          onMove={moveManualBook}
          onReorder={notifyManualReorder}
        />
      );
    }

    return (
      <SelectionBook
        active={selectionMode || selectionExitPending}
        book={book}
        content={bookContent}
        displayMode={displayMode}
        exiting={selectionExitPending}
        key={book.id}
        selected={isSelected}
        modeProgress={selectionUiProgress}
        width={gridItemWidth}
        onToggle={() => toggleBookSelection(book.id)}
      />
    );
  };

  return (
    <>
      <GestureHandlerRootView style={styles.safeArea}>
        <Animated.ScrollView
          contentInsetAdjustmentBehavior={nativeHeaderVisible ? 'automatic' : 'never'}
          contentContainerStyle={[
            styles.scrollContent,
            nativeHeaderVisible ? null : { paddingTop: insets.top + tokens.spacing.compact },
          ]}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={styles.screen}
        >
          <View style={styles.libraryHeaderSpacer} />
          {!libraryReady ? null : books.length === 0 ? (
            <EmptyLibrary onImport={importBooks} />
          ) : (
            <>
              {continueReadingBook ? <ContinueReading book={continueReadingBook} onOpenReader={(frame) => openReaderWithTransition(continueReadingBook, frame)} opening={readerOpeningTransition?.book.id === continueReadingBook.id} selectionMode={selectionMode && !selectionExitPending} /> : null}
              <Animated.View layout={displayModeTransition} style={displayMode === 'grid' ? styles.grid : styles.list}>
                {visibleBooks.map(renderBook)}
              </Animated.View>
              {visibleBooks.length > 0 ? (
                <Animated.View layout={displayModeTransition}>
                  <Text selectable style={styles.bookCount}>{visibleBooks.length}本书</Text>
                </Animated.View>
              ) : null}
              {visibleBooks.length === 0 ? <Text selectable style={styles.noResults}>没有符合此筛选条件的图书</Text> : null}
            </>
          )}
        </Animated.ScrollView>
        <>
          <Animated.View pointerEvents="none" style={[styles.floatingTitle, { top: insets.top + LIBRARY_HEADER_SAFE_TOP_GAP }, floatingTitleStyle]}>
            <Text accessibilityRole="header" style={styles.navigationTitle}>书库</Text>
          </Animated.View>
          {(!selectionMode || selectionExitPending) && !manualOrderingMode ? (
              <View pointerEvents="box-none" style={[styles.floatingMenu, { top: insets.top + LIBRARY_HEADER_SAFE_TOP_GAP }]}>
                <LibraryOverflowMenu
                  booksExist={books.length > 0}
                  filterMode={filterMode}
                  sortMode={sortMode}
                  onImport={importBooks}
                  onSelect={enterSelectionMode}
                  onSort={chooseSortMode}
                  onFilter={setFilterMode}
                  onAdjustOrder={enterManualOrderingMode}
                  selectionProgress={selectionUiProgress}
                  importProgress={importProgress}
                />
              </View>
          ) : null}
        </>
        {selectionMode && !selectionExitPending ? (
          <>
            <View pointerEvents="box-none" style={[styles.selectionHeaderActions, { top: insets.top + LIBRARY_HEADER_SAFE_TOP_GAP }]}>
              <Animated.View layout={layoutTransition}>
                <SelectionGlass style={styles.selectionAllGlass}>
                  <Animated.View style={[styles.selectionControlContent, selectionAllTransitionStyle]}>
                  <Pressable accessibilityRole="button" onPress={toggleAllBooks} style={styles.selectionControlContent}>
                    <Text style={styles.selectionAllButtonText}>{isAllSelected ? '取消全选' : '全选'}</Text>
                  </Pressable>
                  </Animated.View>
                </SelectionGlass>
              </Animated.View>
              <SelectionGlass colorScheme="dark" style={styles.selectionDoneGlass} tintColor="#000000">
                <Animated.View style={[styles.selectionControlContent, selectionDoneTransitionStyle]}>
                  <Pressable accessibilityLabel="完成选择" accessibilityRole="button" onPress={exitSelectionMode} style={styles.selectionControlContent}>
                    <SymbolView name="checkmark" size={24} tintColor="#FFFFFF" weight="heavy" />
                  </Pressable>
                </Animated.View>
              </SelectionGlass>
            </View>
            <Animated.View
              pointerEvents={selectionExitPending ? 'none' : 'box-none'}
              style={[styles.selectionBottomActions, { bottom: insets.bottom }, selectionBottomTransitionStyle]}
            >
              <MenuView actions={selectionDeleteActions} onPressAction={(event) => handleSelectionDeleteAction(event.nativeEvent.event)} style={styles.selectionBottomGlass}>
                <SelectionGlass style={styles.selectionBottomGlass}>
                  <Pressable
                    accessibilityLabel="移除所选图书"
                    accessibilityRole="button"
                    disabled={selectedBookIds.length === 0}
                    style={[styles.selectionControlContent, selectedBookIds.length === 0 ? styles.selectionBottomButtonDisabled : null]}
                  >
                    <SymbolView name="trash.fill" size={28} tintColor={selectedBookIds.length === 0 ? tokens.colors.tertiaryLabel : tokens.colors.label} weight="semibold" />
                  </Pressable>
                </SelectionGlass>
              </MenuView>
              <SelectionGlass style={styles.selectionBottomGlass}>
                <Pressable
                  accessibilityLabel="分享所选图书"
                  accessibilityRole="button"
                  disabled={selectedBookIds.length === 0}
                  onPress={shareSelectedBooks}
                  style={[styles.selectionControlContent, selectedBookIds.length === 0 ? styles.selectionBottomButtonDisabled : null]}
                >
                  <SymbolView name="square.and.arrow.up" size={28} tintColor={selectedBookIds.length === 0 ? tokens.colors.tertiaryLabel : tokens.colors.label} weight="semibold" />
                </Pressable>
              </SelectionGlass>
            </Animated.View>
          </>
        ) : null}
        {manualOrderingMode ? (
          <View pointerEvents="box-none" style={[styles.selectionHeaderActions, { top: insets.top + LIBRARY_HEADER_SAFE_TOP_GAP }]}>
            <SelectionGlass style={styles.manualCancelGlass}>
              <Pressable accessibilityLabel="取消调整顺序" accessibilityRole="button" onPress={cancelManualOrdering} style={styles.selectionControlContent}>
                <Text style={styles.selectionAllButtonText}>取消</Text>
              </Pressable>
            </SelectionGlass>
            <SelectionGlass colorScheme="dark" style={styles.selectionDoneGlass} tintColor="#000000">
              <Pressable accessibilityLabel="完成调整顺序" accessibilityRole="button" onPress={finishManualOrdering} style={styles.selectionControlContent}>
                <SymbolView name="checkmark" size={24} tintColor="#FFFFFF" weight="heavy" />
              </Pressable>
            </SelectionGlass>
          </View>
        ) : null}
        {readerOpeningTransition ? (
          <ReaderOpeningTransitionOverlay
            key={readerOpeningTransition.id}
            onFinished={finishReaderOpeningTransition}
            transition={readerOpeningTransition}
          />
        ) : null}
      </GestureHandlerRootView>
    </>
  );
}

function BookTitleMenu({ book, children, handlers }: {
  book: LibraryBook;
  children: ReactNode;
  handlers?: BookMenuHandlers;
}) {
  if (!handlers) {
    return <View style={styles.bookTitleMenu}>{children}</View>;
  }

  const actions: MenuAction[] = [
    { id: 'share', image: 'square.and.arrow.up' as SFSymbol, title: '分享' },
    {
      id: 'toggle-finished',
      image: (book.state === 'finished' ? 'arrow.uturn.backward' : 'checkmark.circle') as SFSymbol,
      title: book.state === 'finished' ? '标记为未读' : '标记为已读完',
    },
    {
      id: 'edit-info',
      image: 'info.circle' as SFSymbol,
      title: '编辑图书信息',
      subactions: [
        { id: 'edit-cover', image: 'photo' as SFSymbol, title: '封面' },
        { id: 'edit-title', image: 'pencil' as SFSymbol, title: '书名' },
        { id: 'edit-author', image: 'person' as SFSymbol, title: '作者' },
        { id: 'restore-original', image: 'arrow.counterclockwise' as SFSymbol, title: '恢复原始信息' },
      ],
    },
    { id: 'remove', image: 'trash' as SFSymbol, title: '移除', attributes: { destructive: true } },
  ];

  const handleAction = (actionId: string) => {
    if (actionId === 'share') handlers.onShare(book);
    if (actionId === 'toggle-finished') handlers.onToggleFinished(book);
    if (actionId === 'edit-cover') handlers.onEditCover(book);
    if (actionId === 'edit-title') handlers.onEditTitle(book);
    if (actionId === 'edit-author') handlers.onEditAuthor(book);
    if (actionId === 'restore-original') handlers.onRestoreOriginal(book);
    if (actionId === 'remove') handlers.onRemove();
  };

  return (
    <MenuView actions={actions} onPressAction={(event) => handleAction(event.nativeEvent.event)} style={styles.bookTitleMenu} title={book.title}>
      {children}
    </MenuView>
  );
}

function LibraryOverflowMenu({ booksExist, filterMode, sortMode, onImport, onSelect, onSort, onFilter, onAdjustOrder, selectionProgress, importProgress }: {
  booksExist: boolean;
  filterMode: FilterMode;
  sortMode: SortMode;
  onImport: () => void;
  onSelect: () => void;
  onSort: (sortMode: SortMode) => void;
  onFilter: (filterMode: FilterMode) => void;
  onAdjustOrder: () => void;
  selectionProgress: SharedValue<number>;
  /** 0..1 while importing, null when idle. */
  importProgress: number | null;
}) {
  const bookActions: MenuAction[] = booksExist
    ? [
      { id: 'select', title: '选择', image: 'checkmark.circle' as SFSymbol },
      { id: 'adjust-order', title: '调整顺序', image: 'line.3.horizontal' as SFSymbol },
        {
          id: 'sort',
          title: '排序方式',
          image: 'arrow.up.arrow.down' as SFSymbol,
          subactions: (Object.keys(sortLabels) as SortMode[]).map((option) => ({
            id: `sort:${option}`,
            title: sortLabels[option],
            state: sortMode === option ? 'on' : 'off',
          })),
        },
        {
          id: 'filter',
          title: '筛选',
          image: 'line.3.horizontal.decrease.circle' as SFSymbol,
          subactions: (Object.keys(filterLabels) as FilterMode[]).map((option) => ({
            id: `filter:${option}`,
            title: filterLabels[option],
            state: filterMode === option ? 'on' : 'off',
          })),
        },
      ]
    : [];
  const actions: MenuAction[] = [
    { id: 'import', title: '导入图书', image: 'square.and.arrow.down' as SFSymbol },
    ...bookActions,
  ];

  const handleMenuAction = (actionId: string) => {
    if (actionId === 'import') {
      onImport();
    } else if (actionId === 'select') {
      onSelect();
    } else if (actionId === 'adjust-order') {
      onAdjustOrder();
    } else if (actionId.startsWith('sort:')) {
      onSort(actionId.slice(5) as SortMode);
    } else if (actionId.startsWith('filter:')) {
      onFilter(actionId.slice(7) as FilterMode);
    }
  };

  return (
    <MenuView actions={actions} onPressAction={(event) => handleMenuAction(event.nativeEvent.event)}>
      <LibraryMenuTrigger selectionProgress={selectionProgress} importProgress={importProgress} />
    </MenuView>
  );
}

const IMPORT_RING_RADIUS = 19;
const IMPORT_RING_CIRCUMFERENCE = 2 * Math.PI * IMPORT_RING_RADIUS;

function LibraryMenuTrigger({ selectionProgress, importProgress }: { selectionProgress: SharedValue<number>; importProgress: number | null }) {
  const colorScheme = useColorScheme();
  const glyphReturnStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selectionProgress.get(), [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(selectionProgress.get(), [0, 1], [1, 0.85], Extrapolation.CLAMP) }],
  }));
  const importing = importProgress !== null;
  const trigger = (
    <Pressable
      accessibilityLabel="书库菜单"
      accessibilityRole="button"
      accessibilityState={{ disabled: importing }}
      disabled={importing}
      style={[styles.menuTriggerContent, importing && styles.menuTriggerDisabled]}
    >
      <Animated.Text style={[styles.menuTriggerGlyph, glyphReturnStyle]}>•••</Animated.Text>
    </Pressable>
  );

  const surface = isGlassEffectAPIAvailable() ? (
    <GlassView glassEffectStyle="regular" isInteractive style={styles.menuGlass}>
      {trigger}
    </GlassView>
  ) : (
    <View style={styles.menuTriggerFallback}>{trigger}</View>
  );

  return (
    // pointerEvents none while importing so the menu can't be opened mid-import.
    <View style={styles.menuTriggerWrap} pointerEvents={importing ? 'none' : 'auto'}>
      {surface}
      {importing ? (
        <Svg style={styles.menuProgressRing} viewBox="0 0 44 44">
          <Circle
            cx={22}
            cy={22}
            r={IMPORT_RING_RADIUS}
            fill="none"
            stroke={colorScheme === 'dark' ? '#0A84FF' : '#007AFF'}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${IMPORT_RING_CIRCUMFERENCE * Math.min(1, Math.max(0, importProgress))} ${IMPORT_RING_CIRCUMFERENCE}`}
            transform="rotate(-90 22 22)"
          />
        </Svg>
      ) : null}
    </View>
  );
}

function ContinueReading({ book, onOpenReader, opening, selectionMode }: { book: LibraryBook; onOpenReader: (frame: ReaderOpeningFrame) => void; opening: boolean; selectionMode: boolean }) {
  const selectionProgress = useSharedValue(1);
  const coverRef = useRef<View>(null);

  useEffect(() => {
    selectionProgress.set(withTiming(selectionMode ? 0 : 1, { duration: 220 }));
  }, [selectionMode, selectionProgress]);

  const selectionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selectionProgress.get(), [0, 1], [0.48, 1], Extrapolation.CLAMP),
  }));

  const bookPreview = (
    <View style={styles.continueBook}>
      <View collapsable={false} ref={coverRef} style={opening ? styles.openingSourceHidden : null}>
        <BookCover book={book} width={tokens.cover.continueWidth} presentation="continue" />
      </View>
      <View style={styles.continueMetadata}>
        <Text selectable numberOfLines={2} style={styles.continueTitle}>{book.title}</Text>
        {book.author ? <Text selectable numberOfLines={1} style={styles.author}>{book.author}</Text> : null}
        <Text selectable style={styles.progressText}>已读 {displayProgress(book)}%</Text>
        <ProgressBar progress={displayProgress(book) ?? 0} />
      </View>
    </View>
  );

  return (
    <View style={styles.continueSection}>
      <Text selectable style={styles.sectionTitle}>继续阅读</Text>
      <Animated.View pointerEvents={selectionMode ? 'none' : 'auto'} style={selectionStyle}>
        {selectionMode ? bookPreview : (
          <Pressable
            accessibilityLabel={`继续阅读，${book.title}`}
            accessibilityRole="button"
            onPress={() => coverRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
              onOpenReader({ height: measuredHeight, width: measuredWidth, x, y });
            })}
          >
            {bookPreview}
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

function SelectionBook({
  active,
  book,
  content,
  displayMode,
  exiting,
  modeProgress,
  onToggle,
  selected,
  width,
}: {
  active: boolean;
  book: LibraryBook;
  content: ReactNode;
  displayMode: 'grid' | 'list';
  exiting: boolean;
  modeProgress: SharedValue<number>;
  onToggle: () => void;
  selected: boolean;
  width: number;
}) {
  const selectionProgress = useSharedValue(1);

  useEffect(() => {
    const target = active ? (exiting || selected ? 1 : 0) : 1;
    selectionProgress.set(withTiming(target, { duration: selectionTransitionDuration }));
  }, [active, exiting, selected, selectionProgress]);

  const selectionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selectionProgress.get(), [0, 1], [0.48, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(selectionProgress.get(), [0, 1], [0.94, 1], Extrapolation.CLAMP) }],
  }));
  const listContentStyle = useAnimatedStyle(() => ({
    transform: [{
      translateX: displayMode === 'list'
        ? interpolate(modeProgress.get(), [0, 1], [0, 22], Extrapolation.CLAMP)
        : 0,
    }],
  }));
  const listIndicatorStyle = useAnimatedStyle(() => ({
    opacity: displayMode === 'list' ? modeProgress.get() : 0,
    transform: [{
      scale: displayMode === 'list'
        ? interpolate(modeProgress.get(), [0, 1], [0.72, 1], Extrapolation.CLAMP)
        : 0,
    }],
  }));

  return (
    <Animated.View layout={layoutTransition} style={[displayMode === 'grid' ? { width } : undefined, selectionStyle]}>
      <Animated.View style={[styles.selectionContent, listContentStyle]}>{content}</Animated.View>
      {active ? (
        <Pressable
          accessibilityLabel={`${book.title}，${selected ? '已选择' : '未选择'}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          disabled={exiting}
          onPress={onToggle}
          style={displayMode === 'grid' ? styles.selectionGridItem : styles.selectionRow}
        >
          {displayMode === 'list' ? (
            <Animated.View pointerEvents="none" style={[styles.selectionListIndicator, listIndicatorStyle]}>
              <SelectionIndicator compact selected={selected} />
            </Animated.View>
          ) : null}
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function ReorderableBook({
  bookId,
  content,
  displayMode,
  index,
  onMove,
  onReorder,
  totalBooks,
  width,
}: {
  bookId: string;
  content: ReactNode;
  displayMode: 'grid' | 'list';
  index: number;
  onMove: (bookId: string, targetIndex: number) => void;
  onReorder: () => void;
  totalBooks: number;
  width: number;
}) {
  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const isDragging = useSharedValue(0);
  const currentIndex = useSharedValue(index);
  const dragStartIndex = useSharedValue(index);
  const lastTargetIndex = useSharedValue(index);
  const lastReorderTimestamp = useSharedValue(0);
  const layoutOffsetX = useSharedValue(0);
  const layoutOffsetY = useSharedValue(0);
  const [dragging, setDragging] = useState(false);
  const [layoutAnimationsEnabled, setLayoutAnimationsEnabled] = useState(false);
  const gridRowStride = width / tokens.cover.gridAspectRatio + 72 + tokens.spacing.gridRow;
  const gridColumnStride = width + tokens.spacing.grid;
  const listRowStride = tokens.cover.listWidth / tokens.cover.gridAspectRatio + tokens.spacing.listRowVertical * 2;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLayoutAnimationsEnabled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const previousIndex = currentIndex.get();

    if (isDragging.get() > 0 && previousIndex !== index) {
      const horizontalShift = displayMode === 'grid'
        ? (index % 2 - previousIndex % 2) * gridColumnStride
        : 0;
      const verticalShift = displayMode === 'grid'
        ? (Math.floor(index / 2) - Math.floor(previousIndex / 2)) * gridRowStride
        : (index - previousIndex) * listRowStride;

      layoutOffsetX.set(layoutOffsetX.get() - horizontalShift);
      layoutOffsetY.set(layoutOffsetY.get() - verticalShift);
      translationX.set(translationX.get() - horizontalShift);
      translationY.set(translationY.get() - verticalShift);
    }

    currentIndex.set(index);
  }, [currentIndex, displayMode, gridColumnStride, gridRowStride, index, isDragging, layoutOffsetX, layoutOffsetY, listRowStride, translationX, translationY]);

  const dragStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translationX.get() },
      { translateY: translationY.get() },
      { scale: interpolate(isDragging.get(), [0, 1], [1, 1.025], Extrapolation.CLAMP) },
    ],
  }));
  const dragContainerStyle = useAnimatedStyle(() => ({
    zIndex: isDragging.get() > 0 ? 10 : 0,
  }));

  const gesture = useMemo(
    () => Gesture.Pan()
      .activateAfterLongPress(180)
      .onBegin(() => {
        isDragging.set(1);
        dragStartIndex.set(currentIndex.get());
        lastTargetIndex.set(currentIndex.get());
        lastReorderTimestamp.set(0);
        layoutOffsetX.set(0);
        layoutOffsetY.set(0);
        runOnJS(setDragging)(true);
      })
      .onUpdate((event) => {
        translationX.set(displayMode === 'grid' ? event.translationX + layoutOffsetX.get() : 0);
        translationY.set(event.translationY + layoutOffsetY.get());

        const rawTargetIndex = displayMode === 'grid'
          ? dragStartIndex.get()
            + Math.round(event.translationY / gridRowStride) * 2
            + Math.round(event.translationX / gridColumnStride)
          : dragStartIndex.get() + Math.round(event.translationY / listRowStride);
        const targetIndex = Math.max(0, Math.min(rawTargetIndex, totalBooks - 1));

        const now = Date.now();
        const canReorder = now - lastReorderTimestamp.get() >= 75;
        if (lastTargetIndex.get() !== targetIndex && canReorder) {
          lastTargetIndex.set(targetIndex);
          lastReorderTimestamp.set(now);
          runOnJS(onReorder)();
          runOnJS(onMove)(bookId, targetIndex);
        }
      })
      .onEnd((event) => {
        const rawTargetIndex = displayMode === 'grid'
          ? dragStartIndex.get()
            + Math.round(event.translationY / gridRowStride) * 2
            + Math.round(event.translationX / gridColumnStride)
          : dragStartIndex.get() + Math.round(event.translationY / listRowStride);
        const targetIndex = Math.max(0, Math.min(rawTargetIndex, totalBooks - 1));
        if (lastTargetIndex.get() !== targetIndex) {
          lastReorderTimestamp.set(Date.now());
          runOnJS(onReorder)();
          runOnJS(onMove)(bookId, targetIndex);
        }
      })
      .onFinalize(() => {
        isDragging.set(withTiming(0, { duration: tokens.animation.pressDuration }));
        translationX.set(withTiming(0, { duration: tokens.animation.layoutDuration }));
        translationY.set(withTiming(0, { duration: tokens.animation.layoutDuration }));
        layoutOffsetX.set(0);
        layoutOffsetY.set(0);
        runOnJS(setDragging)(false);
      }),
    [bookId, currentIndex, displayMode, dragStartIndex, gridColumnStride, gridRowStride, isDragging, lastReorderTimestamp, lastTargetIndex, layoutOffsetX, layoutOffsetY, listRowStride, onMove, onReorder, totalBooks, translationX, translationY],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityLabel="长按后拖动以调整书籍顺序"
        accessible
        collapsable={false}
        layout={dragging || !layoutAnimationsEnabled ? undefined : reorderLayoutTransition}
        style={[displayMode === 'grid' ? { width } : undefined, styles.manualReorderItem, dragContainerStyle]}
      >
        <Animated.View style={dragStyle}>{content}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function GridBook({ book, manualOrdering, onOpenReader, opening, titleMenu, width, selected, selectionMode }: { book: LibraryBook; manualOrdering: boolean; onOpenReader?: (frame: ReaderOpeningFrame) => void; opening: boolean; titleMenu?: BookMenuHandlers; width: number; selected: boolean; selectionMode: boolean }) {
  const coverRef = useRef<View>(null);
  return (
    <View style={[styles.gridBook, { width }]}>
      <View style={[styles.coverWrap, opening ? styles.openingSourceHidden : null]}>
        <Pressable
          accessibilityLabel={`打开 ${book.title}`}
          accessibilityRole="button"
          disabled={!onOpenReader}
          onPress={() => coverRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
            onOpenReader?.({ height: measuredHeight, width: measuredWidth, x, y });
          })}
        >
          <View collapsable={false} ref={coverRef}>
            <BookCover book={book} width={width} presentation="grid" />
          </View>
        </Pressable>
        {selected ? <View pointerEvents="none" style={styles.coverSelectionCenter}><SelectionIndicator selected /></View> : null}
      </View>
      {!selectionMode ? (
        <BookTitleMenu book={book} handlers={titleMenu}>
          <View style={styles.gridMenuTrigger}>
            <Text selectable numberOfLines={manualOrdering ? 1 : 2} style={styles.gridTitle}>{book.title}</Text>
            <Text selectable style={styles.gridState}>{readingStateLabel(book)}</Text>
          </View>
        </BookTitleMenu>
      ) : null}
    </View>
  );
}

function ListBook({ book, manualOrdering, onOpenReader, opening, titleMenu, selected, selectionMode }: { book: LibraryBook; manualOrdering: boolean; onOpenReader?: (frame: ReaderOpeningFrame) => void; opening: boolean; titleMenu?: BookMenuHandlers; selected: boolean; selectionMode: boolean }) {
  const coverRef = useRef<View>(null);
  return (
    <View style={styles.listBook}>
      <View style={[styles.listCoverWrap, opening ? styles.openingSourceHidden : null]}>
        <Pressable
          accessibilityLabel={`打开 ${book.title}`}
          accessibilityRole="button"
          disabled={!onOpenReader}
          onPress={() => coverRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
            onOpenReader?.({ height: measuredHeight, width: measuredWidth, x, y });
          })}
        >
          <View collapsable={false} ref={coverRef}>
            <BookCover book={book} width={tokens.cover.listWidth} presentation="list" />
          </View>
        </Pressable>
        {selected ? <SelectionIndicator selected /> : null}
      </View>
      <View style={styles.listMetadata}>
        <BookTitleMenu book={book} handlers={titleMenu}>
          <View style={styles.listMenuTrigger}>
            <Text selectable numberOfLines={manualOrdering ? 1 : 2} style={styles.listTitle}>{book.title}</Text>
            {book.author ? <Text selectable numberOfLines={1} style={styles.author}>{book.author}</Text> : null}
            {!selectionMode ? <Text selectable style={styles.listState}>{readingStateLabel(book)}</Text> : null}
          </View>
        </BookTitleMenu>
      </View>
    </View>
  );
}

function BookCover({
  book,
  width,
  presentation,
}: {
  book: LibraryBook;
  width: number;
  presentation: 'grid' | 'continue' | 'list';
}) {
  const height = width / tokens.cover.gridAspectRatio;
  const shadowStyle = presentation === 'grid'
    ? styles.coverShadowGrid
    : presentation === 'continue'
      ? styles.coverShadowContinue
      : styles.coverShadowList;
  const tightShadowStyle = presentation === 'grid'
    ? styles.coverShadowGridTight
    : presentation === 'continue'
      ? styles.coverShadowContinueTight
      : styles.coverShadowListTight;
  const coverBackground = tokens.coverTones[book.coverTone];

  return (
    <View
      accessibilityLabel={`${book.title}的${book.hasGeneratedCover ? '默认' : '模拟'}封面`}
      style={[styles.coverContainer, { width, height }]}
    >
      <View style={[styles.coverShadow, shadowStyle, { backgroundColor: coverBackground }]}>
        <View style={[styles.coverShadowTight, tightShadowStyle, { backgroundColor: coverBackground }]}>
          <BookCoverArt
            author={book.author}
            coverTone={book.coverTone}
            coverUri={book.coverUri}
            hasGeneratedCover={book.hasGeneratedCover}
            title={book.title}
          />
        </View>
      </View>
    </View>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <View accessibilityLabel={`阅读进度 ${progress}%`} accessibilityRole="progressbar" style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${progress}%` }]} />
    </View>
  );
}

function SelectionIndicator({ compact = false, selected }: { compact?: boolean; selected: boolean }) {
  return (
    <View style={[styles.selectionIndicator, compact ? styles.selectionIndicatorCompact : null, selected ? styles.selectionIndicatorSelected : null]}>
      {selected ? <SymbolView name="checkmark" size={compact ? 13 : 15} tintColor="#FFFFFF" weight="bold" /> : null}
    </View>
  );
}

function SelectionGlass({
  children,
  colorScheme,
  style,
  tintColor,
}: {
  children: ReactNode;
  colorScheme?: 'auto' | 'light' | 'dark';
  style: StyleProp<ViewStyle>;
  tintColor?: string;
}) {
  if (isGlassEffectAPIAvailable()) {
    return (
      <GlassView colorScheme={colorScheme} glassEffectStyle="regular" isInteractive style={style} tintColor={tintColor}>
        {children}
      </GlassView>
    );
  }

  return <View style={[styles.selectionGlassFallback, style]}>{children}</View>;
}

function EmptyLibrary({ onImport }: { onImport: () => void }) {
  return (
    <View style={styles.emptyState}>
      <Text accessibilityLabel="书本" style={styles.emptySymbol}>▤</Text>
      <Text selectable style={styles.emptyTitle}>书库还是空的</Text>
      <Text selectable style={styles.emptyDescription}>导入一本书开始阅读</Text>
      <Pressable accessibilityRole="button" onPress={onImport} style={styles.importButton}><Text style={styles.importButtonText}>导入图书</Text></Pressable>
    </View>
  );
}

function readingStateLabel(book: LibraryBook) {
  if (book.state === 'finished') return '已读完';
  if (book.progress === null) return '未开始';
  return `${displayProgress(book)}%`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: tokens.colors.background },
  screen: { flex: 1, backgroundColor: tokens.colors.background },
  libraryHeaderSpacer: { height: 44 },
  floatingTitle: { left: tokens.spacing.screen, position: 'absolute' },
  navigationTitle: { color: tokens.colors.label, fontSize: tokens.typography.largeTitle, fontWeight: '700', letterSpacing: -0.6, lineHeight: 40 },
  floatingMenu: { position: 'absolute', right: tokens.spacing.medium },
  menuGlass: { borderRadius: 22, height: 44, width: 44 },
  menuTriggerFallback: { borderColor: tokens.colors.separator, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, height: 44, width: 44 },
  menuTriggerContent: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  menuTriggerDisabled: { opacity: 0.5 },
  menuTriggerWrap: { height: 44, width: 44 },
  menuProgressRing: { height: 44, left: 0, position: 'absolute', top: 0, width: 44 },
  menuTriggerGlyph: { color: tokens.colors.label, fontSize: 18, fontWeight: '700', letterSpacing: 1, marginLeft: 1, marginTop: -2 },
  scrollContent: { paddingHorizontal: tokens.spacing.screen, paddingBottom: tokens.spacing.section * 6, gap: tokens.spacing.section },
  continueSection: { gap: tokens.spacing.item },
  continueBook: { flexDirection: 'row', gap: tokens.spacing.medium, minHeight: 138 },
  continueMetadata: { flex: 1, justifyContent: 'center', gap: tokens.spacing.compact },
  continueTitle: { color: tokens.colors.label, fontSize: tokens.typography.bookTitle, fontWeight: '500', lineHeight: 20 },
  author: { color: tokens.colors.secondaryLabel, fontSize: tokens.typography.metadata, lineHeight: 19 },
  progressText: { color: tokens.colors.tertiaryLabel, fontSize: 13, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 1, borderRadius: 1, backgroundColor: tokens.colors.fill, overflow: 'hidden' },
  progressFill: { height: 1, borderRadius: 1, backgroundColor: tokens.colors.secondaryLabel },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: tokens.spacing.item },
  sectionTitle: { color: tokens.colors.label, fontSize: tokens.typography.sectionTitle, fontWeight: '700', letterSpacing: -0.15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: tokens.spacing.grid, rowGap: tokens.spacing.gridRow },
  list: { gap: 0 },
  bookPressable: { minHeight: 44 },
  bookTitleMenu: { alignSelf: 'flex-start' },
  manualReorderItem: { minHeight: 44 },
  gridBook: { gap: 4 },
  gridMenuTrigger: { gap: 2, minHeight: 42 },
  coverWrap: { position: 'relative' },
  openingSourceHidden: { opacity: 0 },
  coverSelectionCenter: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 2 },
  gridTitle: { color: tokens.colors.label, fontSize: 14, fontWeight: '600', lineHeight: 18, minHeight: 18 },
  gridState: { color: tokens.colors.secondaryLabel, fontSize: 12, fontVariant: ['tabular-nums'] },
  listBook: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.listGap, paddingVertical: tokens.spacing.listRowVertical },
  listCoverWrap: { position: 'relative' },
  listMetadata: { alignSelf: 'stretch', flex: 1, gap: 1, justifyContent: 'center' },
  listMenuTrigger: { alignSelf: 'stretch', gap: 1, justifyContent: 'center', minHeight: 58 },
  listTitle: { color: tokens.colors.label, fontSize: tokens.typography.bookTitle, fontWeight: '600', lineHeight: 20 },
  listState: { color: tokens.colors.tertiaryLabel, fontSize: 13, fontVariant: ['tabular-nums'] },
  coverContainer: { position: 'relative' },
  coverShadow: { borderRadius: tokens.radius.cover, height: '100%', width: '100%', zIndex: 1 },
  coverShadowGrid: { shadowColor: tokens.shadows.coverGrid.color, shadowOpacity: tokens.shadows.coverGrid.opacity, shadowRadius: tokens.shadows.coverGrid.radius, shadowOffset: { width: 0, height: tokens.shadows.coverGrid.offsetY } },
  coverShadowGridTight: { shadowColor: tokens.shadows.coverGridTight.color, shadowOpacity: tokens.shadows.coverGridTight.opacity, shadowRadius: tokens.shadows.coverGridTight.radius, shadowOffset: { width: 0, height: tokens.shadows.coverGridTight.offsetY } },
  coverShadowContinue: { shadowColor: tokens.shadows.coverContinue.color, shadowOpacity: tokens.shadows.coverContinue.opacity, shadowRadius: tokens.shadows.coverContinue.radius, shadowOffset: { width: 0, height: tokens.shadows.coverContinue.offsetY } },
  coverShadowContinueTight: { shadowColor: tokens.shadows.coverContinueTight.color, shadowOpacity: tokens.shadows.coverContinueTight.opacity, shadowRadius: tokens.shadows.coverContinueTight.radius, shadowOffset: { width: 0, height: tokens.shadows.coverContinueTight.offsetY } },
  coverShadowList: { shadowColor: tokens.shadows.coverList.color, shadowOpacity: tokens.shadows.coverList.opacity, shadowRadius: tokens.shadows.coverList.radius, shadowOffset: { width: 0, height: tokens.shadows.coverList.offsetY } },
  coverShadowListTight: { shadowColor: tokens.shadows.coverListTight.color, shadowOpacity: tokens.shadows.coverListTight.opacity, shadowRadius: tokens.shadows.coverListTight.radius, shadowOffset: { width: 0, height: tokens.shadows.coverListTight.offsetY } },
  coverShadowTight: { borderRadius: tokens.radius.cover, flex: 1 },
  readerOpeningCover: {
    borderCurve: 'continuous',
    borderRadius: tokens.radius.cover,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  readerOpeningTransition: { zIndex: 100 },
  selectionRow: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 3 },
  selectionGridItem: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 3 },
  selectionContent: { flex: 1 },
  selectionIndicator: { alignItems: 'center', backgroundColor: tokens.colors.background, borderColor: tokens.colors.tertiaryLabel, borderRadius: 14, borderWidth: 2, height: 28, justifyContent: 'center', width: 28 },
  selectionIndicatorCompact: { borderRadius: 12, height: 24, width: 24 },
  selectionIndicatorSelected: { backgroundColor: '#000000', borderColor: '#000000' },
  selectionListIndicator: { left: -10, position: 'absolute', top: 35, zIndex: 2 },
  selectionHeaderActions: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.compact, position: 'absolute', right: tokens.spacing.medium },
  selectionGlassFallback: { backgroundColor: tokens.colors.background, borderColor: tokens.colors.separator, borderWidth: StyleSheet.hairlineWidth },
  selectionAllGlass: { borderRadius: 22, height: 44, minWidth: 76, paddingHorizontal: tokens.spacing.item },
  manualCancelGlass: { borderRadius: 22, height: 44, minWidth: 68, paddingHorizontal: tokens.spacing.item },
  selectionDoneGlass: { borderRadius: 22, height: 44, width: 44 },
  selectionBottomGlass: { borderRadius: 28, height: 56, width: 56 },
  selectionControlContent: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  selectionAllButtonText: { color: tokens.colors.label, fontSize: 17, fontWeight: '600' },
  selectionBottomActions: { flexDirection: 'row', justifyContent: 'space-between', left: tokens.spacing.screen, position: 'absolute', right: tokens.spacing.screen },
  selectionBottomButtonDisabled: { opacity: 0.45 },
  emptyState: { flex: 1, minHeight: 440, justifyContent: 'center', alignItems: 'center', gap: tokens.spacing.compact, paddingBottom: 72 },
  emptySymbol: { color: tokens.colors.secondaryLabel, fontSize: 50, marginBottom: tokens.spacing.compact },
  emptyTitle: { color: tokens.colors.label, fontSize: tokens.typography.sectionTitle, fontWeight: '700' },
  emptyDescription: { color: tokens.colors.secondaryLabel, fontSize: tokens.typography.metadata },
  importButton: { minHeight: 44, borderRadius: 22, backgroundColor: tokens.colors.blue, justifyContent: 'center', paddingHorizontal: tokens.spacing.section, marginTop: tokens.spacing.item },
  importButtonText: { color: '#FFFFFF', fontSize: tokens.typography.body, fontWeight: '600' },
  bookCount: { color: tokens.colors.secondaryLabel, fontSize: tokens.typography.metadata, paddingTop: tokens.spacing.section * 2, textAlign: 'center' },
  noResults: { color: tokens.colors.secondaryLabel, fontSize: tokens.typography.metadata, paddingVertical: tokens.spacing.section, textAlign: 'center' },
});