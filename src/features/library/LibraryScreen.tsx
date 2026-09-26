import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { SymbolView } from 'expo-symbols';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SFSymbol } from 'sf-symbols-typescript';
import {
  Alert,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '../../design-system/tokens';
import { readerSettingsRepository } from '../reader/reader-settings-repository';
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
import { ContinueReading } from './components/ContinueReading';
import { EmptyLibrary } from './components/EmptyLibrary';
import { GridBook } from './components/GridBook';
import { LibraryOverflowMenu } from './components/LibraryOverflowMenu';
import { ListBook } from './components/ListBook';
import { ReaderOpeningTransitionOverlay } from './components/ReaderOpeningTransitionOverlay';
import { ReorderableBook } from './components/ReorderableBook';
import { SelectionBook } from './components/SelectionBook';
import { SelectionGlass } from './components/SelectionGlass';
import {
  LIBRARY_HEADER_SAFE_TOP_GAP,
  LIBRARY_SCREEN_MARGIN,
  displayModeTransition,
  layoutTransition,
  selectionTransitionDuration,
  toLibraryBook,
} from './components/library-shared';
import type {
  BookMenuHandlers,
  FilterMode,
  LibraryBook,
  ReaderOpeningFrame,
  ReaderOpeningTransition,
  SortMode,
} from './components/library-shared';
import { styles } from './components/library-styles';

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

  const gridItemWidth = Math.max(0, (width - LIBRARY_SCREEN_MARGIN * 2 - tokens.spacing.grid) / 2);
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
      {/* Fade the status bar out the moment the opening cover animation
          starts, instead of waiting for the reader route to mount. React
          Native merges stacked StatusBar props, so the reader's own
          StatusBar takes over seamlessly on mount, and this restores
          automatically when the transition tears down. */}
      <StatusBar animated hidden={readerOpeningTransition != null} />
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
