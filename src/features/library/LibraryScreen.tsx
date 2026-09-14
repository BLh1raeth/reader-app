import { Link, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { tokens } from '../../design-system/tokens';
import {
  mockBooks,
  type MockBook,
  type ReadingState,
  USE_EMPTY_LIBRARY_MOCK,
} from './library-mock';
import { useLibraryView } from './library-view-context';

type SortMode = 'manual' | 'recentlyRead' | 'recentlyAdded' | 'title' | 'author';
type FilterMode = 'all' | ReadingState;

const layoutTransition = LinearTransition.duration(tokens.animation.layoutDuration).reduceMotion(
  ReduceMotion.System,
);

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

export default function LibraryScreen() {
  const { width } = useWindowDimensions();
  const { displayMode } = useLibraryView();
  const [books, setBooks] = useState<MockBook[]>(USE_EMPTY_LIBRARY_MOCK ? [] : mockBooks);
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [manualOrderSnapshot, setManualOrderSnapshot] = useState<MockBook[] | null>(null);
  const [manualOrderingMode, setManualOrderingMode] = useState(false);

  const gridItemWidth = Math.max(0, (width - tokens.spacing.screen * 2 - tokens.spacing.item) / 2);
  const selectedBookSet = useMemo(() => new Set(selectedBookIds), [selectedBookIds]);
  const isAllSelected = books.length > 0 && selectedBookIds.length === books.length;

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
        return sorted.sort((left, right) => left.author.localeCompare(right.author, 'zh-Hans-CN'));
      case 'manual':
      default:
        return sorted;
    }
  }, [books, filterMode, sortMode]);

  const continueReadingBook = useMemo(
    () =>
      books
        .filter((book) => book.state === 'reading' && book.lastReadAt)
        .sort(
          (left, right) => new Date(right.lastReadAt ?? 0).getTime() - new Date(left.lastReadAt ?? 0).getTime(),
        )[0],
    [books],
  );

  const announcePlaceholder = useCallback((title: string) => {
    Alert.alert(title, '这是本阶段的 Mock 交互，不会读取或修改真实图书文件。');
  }, []);

  const updateBook = useCallback((bookId: string, updater: (book: MockBook) => MockBook) => {
    setBooks((currentBooks) => currentBooks.map((book) => (book.id === bookId ? updater(book) : book)));
  }, []);

  const toggleFinished = useCallback(
    (book: MockBook) => {
      updateBook(book.id, (currentBook) =>
        currentBook.state === 'finished'
          ? { ...currentBook, state: 'unread', progress: 0 }
          : { ...currentBook, state: 'finished', progress: 100 },
      );
    },
    [updateBook],
  );

  const renameBook = useCallback(
    (book: MockBook) => {
      Alert.prompt(
        '重新命名…',
        '新名称仅保存在本次 Mock 运行中。',
        (title) => {
          const trimmedTitle = title.trim();
          if (trimmedTitle) {
            updateBook(book.id, (currentBook) => ({ ...currentBook, title: trimmedTitle }));
          }
        },
        'plain-text',
        book.title,
      );
    },
    [updateBook],
  );

  const removeBooks = useCallback((bookIds: string[]) => {
    if (bookIds.length === 0) {
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setBooks((currentBooks) => currentBooks.filter((book) => !bookIds.includes(book.id)));
    setSelectedBookIds((currentIds) => currentIds.filter((bookId) => !bookIds.includes(bookId)));
  }, []);

  const toggleBookSelection = useCallback((bookId: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    setSelectedBookIds((currentIds) =>
      currentIds.includes(bookId)
        ? currentIds.filter((currentBookId) => currentBookId !== bookId)
        : [...currentIds, bookId],
    );
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectedBookIds([]);
    setSelectionMode(false);
  }, []);

  const toggleAllBooks = useCallback(() => {
    Haptics.selectionAsync().catch(() => undefined);
    setSelectedBookIds(isAllSelected ? [] : books.map((book) => book.id));
  }, [books, isAllSelected]);

  const enterManualOrderingMode = useCallback(() => {
    setManualOrderSnapshot(books);
    setManualOrderingMode(true);
  }, [books]);

  const cancelManualOrdering = useCallback(() => {
    if (manualOrderSnapshot) {
      setBooks(manualOrderSnapshot);
    }
    setManualOrderSnapshot(null);
    setManualOrderingMode(false);
  }, [manualOrderSnapshot]);

  const finishManualOrdering = useCallback(() => {
    setManualOrderSnapshot(null);
    setManualOrderingMode(false);
  }, []);

  const chooseSortMode = useCallback(
    (nextSortMode: SortMode) => {
      setSortMode(nextSortMode);
      if (nextSortMode === 'manual') {
        enterManualOrderingMode();
      }
    },
    [enterManualOrderingMode],
  );

  const renderBook = (book: MockBook) => {
    const isSelected = selectedBookSet.has(book.id);
    const bookContent = displayMode === 'grid'
      ? <GridBook book={book} width={gridItemWidth} selected={false} manualOrdering={manualOrderingMode} />
      : <ListBook book={book} selected={false} manualOrdering={manualOrderingMode} />;

    if (selectionMode) {
      return (
        <Animated.View key={book.id} layout={layoutTransition} style={displayMode === 'grid' ? { width: gridItemWidth } : undefined}>
          <Pressable
            accessibilityLabel={`${book.title}，${isSelected ? '已选择' : '未选择'}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            onPress={() => toggleBookSelection(book.id)}
            style={displayMode === 'grid' ? styles.selectionGridItem : styles.selectionRow}
          >
            <View style={displayMode === 'grid' ? styles.selectionGridIndicator : undefined}>
              <SelectionIndicator selected={isSelected} />
            </View>
            <View style={styles.selectionContent}>{bookContent}</View>
          </Pressable>
        </Animated.View>
      );
    }

    return (
      <Animated.View key={book.id} layout={layoutTransition}>
        <Link href={{ pathname: '/reader/[bookId]', params: { bookId: book.id } }} asChild>
          <Link.Trigger>
            <Pressable
              accessibilityLabel={`${book.title}，${book.author}，${readingStateLabel(book)}`}
              accessibilityRole="button"
              style={styles.bookPressable}
            >
              {bookContent}
            </Pressable>
          </Link.Trigger>
          <Link.Menu title={book.title}>
            <Link.MenuAction icon="square.and.arrow.up" onPress={() => announcePlaceholder('分享')}>分享</Link.MenuAction>
            <Link.MenuAction
              icon={book.state === 'finished' ? 'arrow.uturn.backward' : 'checkmark.circle'}
              onPress={() => toggleFinished(book)}
            >
              {book.state === 'finished' ? '标记为未读' : '标记为已读完'}
            </Link.MenuAction>
            <Link.MenuAction icon="pencil" onPress={() => renameBook(book)}>重新命名…</Link.MenuAction>
            <Link.MenuAction icon="trash" destructive onPress={() => removeBooks([book.id])}>移除…</Link.MenuAction>
          </Link.Menu>
        </Link>
      </Animated.View>
    );
  };

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        style={styles.screen}
      >
        {books.length === 0 ? (
          <EmptyLibrary onImport={() => announcePlaceholder('导入图书')} />
        ) : (
          <>
            {continueReadingBook ? <ContinueReading book={continueReadingBook} /> : null}
            <View style={styles.sectionHeader}>
              <Text selectable style={styles.sectionTitle}>全部图书</Text>
              <Text selectable style={styles.sectionMetadata}>{filterLabels[filterMode]} · {sortLabels[sortMode]}</Text>
            </View>
            <View style={displayMode === 'grid' ? styles.grid : styles.list}>{visibleBooks.map(renderBook)}</View>
            {visibleBooks.length === 0 ? <Text selectable style={styles.noResults}>没有符合此筛选条件的图书</Text> : null}
          </>
        )}
      </ScrollView>

      <Stack.Screen.Title large>{selectionMode ? '选择图书' : manualOrderingMode ? '调整顺序' : '书库'}</Stack.Screen.Title>

      {selectionMode ? (
        <>
          <Stack.Toolbar placement="left"><Stack.Toolbar.Button onPress={exitSelectionMode}>取消</Stack.Toolbar.Button></Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button onPress={toggleAllBooks}>{isAllSelected ? '取消全选' : '全选'}</Stack.Toolbar.Button>
            <Stack.Toolbar.Button variant="done" onPress={exitSelectionMode}>完成</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="bottom">
            <Stack.Toolbar.Button disabled={selectedBookIds.length === 0} icon="trash" tintColor={tokens.colors.destructive} onPress={() => removeBooks(selectedBookIds)} />
            <Stack.Toolbar.Spacer />
            <Stack.Toolbar.Button disabled={selectedBookIds.length === 0} icon="square.and.arrow.up" onPress={() => announcePlaceholder('批量分享')} />
          </Stack.Toolbar>
        </>
      ) : manualOrderingMode ? (
        <>
          <Stack.Toolbar placement="left"><Stack.Toolbar.Button onPress={cancelManualOrdering}>取消</Stack.Toolbar.Button></Stack.Toolbar>
          <Stack.Toolbar placement="right"><Stack.Toolbar.Button variant="done" onPress={finishManualOrdering}>完成</Stack.Toolbar.Button></Stack.Toolbar>
        </>
      ) : (
        <LibraryToolbar
          booksExist={books.length > 0}
          filterMode={filterMode}
          sortMode={sortMode}
          onImport={() => announcePlaceholder('导入图书')}
          onSelect={() => setSelectionMode(true)}
          onSort={chooseSortMode}
          onFilter={setFilterMode}
          onAdjustOrder={enterManualOrderingMode}
        />
      )}
    </>
  );
}

function LibraryToolbar({ booksExist, filterMode, sortMode, onImport, onSelect, onSort, onFilter, onAdjustOrder }: {
  booksExist: boolean;
  filterMode: FilterMode;
  sortMode: SortMode;
  onImport: () => void;
  onSelect: () => void;
  onSort: (sortMode: SortMode) => void;
  onFilter: (filterMode: FilterMode) => void;
  onAdjustOrder: () => void;
}) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis">
        <Stack.Toolbar.MenuAction icon="square.and.arrow.down" onPress={onImport}>导入图书…</Stack.Toolbar.MenuAction>
        {booksExist ? (
          <>
            <Stack.Toolbar.MenuAction icon="checkmark.circle" onPress={onSelect}>选择</Stack.Toolbar.MenuAction>
            {sortMode === 'manual' ? <Stack.Toolbar.MenuAction icon="line.3.horizontal" onPress={onAdjustOrder}>调整顺序</Stack.Toolbar.MenuAction> : null}
            <Stack.Toolbar.Menu title="排序方式" icon="arrow.up.arrow.down">
              <Stack.Toolbar.Menu inline>
                {(Object.keys(sortLabels) as SortMode[]).map((sortOption) => (
                  <Stack.Toolbar.MenuAction isOn={sortMode === sortOption} key={sortOption} onPress={() => onSort(sortOption)}>
                    {sortLabels[sortOption]}
                  </Stack.Toolbar.MenuAction>
                ))}
              </Stack.Toolbar.Menu>
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.Menu title="筛选" icon="line.3.horizontal.decrease.circle">
              <Stack.Toolbar.Menu inline>
                {(Object.keys(filterLabels) as FilterMode[]).map((filterOption) => (
                  <Stack.Toolbar.MenuAction isOn={filterMode === filterOption} key={filterOption} onPress={() => onFilter(filterOption)}>
                    {filterLabels[filterOption]}
                  </Stack.Toolbar.MenuAction>
                ))}
              </Stack.Toolbar.Menu>
            </Stack.Toolbar.Menu>
          </>
        ) : null}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

function ContinueReading({ book }: { book: MockBook }) {
  return (
    <Link href={{ pathname: '/reader/[bookId]', params: { bookId: book.id } }} asChild>
      <Pressable accessibilityLabel={`继续阅读，${book.title}`} accessibilityRole="button" style={styles.continueSection}>
        <Text selectable style={styles.sectionTitle}>继续阅读</Text>
        <View style={styles.continueBook}>
          <BookCover book={book} width={tokens.cover.continueWidth} />
          <View style={styles.continueMetadata}>
            <Text selectable numberOfLines={2} style={styles.continueTitle}>{book.title}</Text>
            <Text selectable numberOfLines={1} style={styles.author}>{book.author}</Text>
            <Text selectable style={styles.progressText}>已读 {book.progress}%</Text>
            <ProgressBar progress={book.progress} />
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

function GridBook({ book, width, selected, manualOrdering }: { book: MockBook; width: number; selected: boolean; manualOrdering: boolean }) {
  return (
    <View style={[styles.gridBook, { width }]}>
      <View style={styles.coverWrap}>
        <BookCover book={book} width={width} />
        {selected ? <SelectionIndicator selected /> : null}
      </View>
      <Text selectable numberOfLines={2} style={styles.gridTitle}>{book.title}</Text>
      <Text selectable style={styles.gridState}>{readingStateLabel(book)}</Text>
      {manualOrdering ? <Text accessibilityLabel="排序拖拽手柄" style={styles.gridHandle}>☰</Text> : null}
    </View>
  );
}

function ListBook({ book, selected, manualOrdering }: { book: MockBook; selected: boolean; manualOrdering: boolean }) {
  return (
    <View style={styles.listBook}>
      <View style={styles.listCoverWrap}>
        <BookCover book={book} width={tokens.cover.listWidth} />
        {selected ? <SelectionIndicator selected /> : null}
      </View>
      <View style={styles.listMetadata}>
        <Text selectable numberOfLines={2} style={styles.listTitle}>{book.title}</Text>
        <Text selectable numberOfLines={1} style={styles.author}>{book.author}</Text>
        <Text selectable style={styles.listState}>{readingStateLabel(book)}</Text>
      </View>
      {manualOrdering ? <Text accessibilityLabel="排序拖拽手柄" style={styles.listHandle}>☰</Text> : null}
    </View>
  );
}

function BookCover({ book, width }: { book: MockBook; width: number }) {
  const height = width / tokens.cover.gridAspectRatio;
  const isLightTone = book.coverTone === 'paper' || book.coverTone === 'mist';

  return (
    <View
      accessibilityLabel={`${book.title}的${book.hasGeneratedCover ? '默认' : '模拟'}封面`}
      style={[styles.cover, { width, height, backgroundColor: tokens.coverTones[book.coverTone] }]}
    >
      <View style={styles.coverAccent} />
      <Text numberOfLines={3} style={[styles.coverTitle, isLightTone ? styles.coverTitleDark : styles.coverTitleLight]}>{book.title}</Text>
      <Text numberOfLines={1} style={[styles.coverAuthor, isLightTone ? styles.coverTitleDark : styles.coverTitleLight]}>{book.author}</Text>
      {book.hasGeneratedCover ? <Text style={[styles.coverGeneratedLabel, isLightTone ? styles.coverTitleDark : styles.coverTitleLight]}>阅读</Text> : null}
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

function SelectionIndicator({ selected }: { selected: boolean }) {
  return <View style={[styles.selectionIndicator, selected ? styles.selectionIndicatorSelected : null]} />;
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

function readingStateLabel(book: MockBook) {
  if (book.state === 'finished') return '已读完';
  if (book.state === 'unread') return '未开始';
  return `${book.progress}%`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.colors.background },
  scrollContent: { paddingHorizontal: tokens.spacing.screen, paddingBottom: tokens.spacing.section * 2, gap: tokens.spacing.section },
  continueSection: { gap: tokens.spacing.item },
  continueBook: { flexDirection: 'row', gap: tokens.spacing.section, minHeight: 138 },
  continueMetadata: { flex: 1, justifyContent: 'center', gap: tokens.spacing.compact },
  continueTitle: { color: tokens.colors.label, fontSize: tokens.typography.bookTitle, fontWeight: '600', lineHeight: 21 },
  author: { color: tokens.colors.secondaryLabel, fontSize: tokens.typography.metadata, lineHeight: 20 },
  progressText: { color: tokens.colors.secondaryLabel, fontSize: tokens.typography.metadata, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 2, borderRadius: 1, backgroundColor: tokens.colors.fill, overflow: 'hidden' },
  progressFill: { height: 2, borderRadius: 1, backgroundColor: tokens.colors.label },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: tokens.spacing.item },
  sectionTitle: { color: tokens.colors.label, fontSize: tokens.typography.sectionTitle, fontWeight: '700', letterSpacing: -0.2 },
  sectionMetadata: { color: tokens.colors.tertiaryLabel, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: tokens.spacing.item, rowGap: tokens.spacing.section },
  list: { gap: 0 },
  bookPressable: { minHeight: 44 },
  gridBook: { gap: 5 },
  coverWrap: { position: 'relative' },
  gridTitle: { color: tokens.colors.label, fontSize: tokens.typography.metadata, fontWeight: '500', lineHeight: 19, minHeight: 19 },
  gridState: { color: tokens.colors.secondaryLabel, fontSize: 14, fontVariant: ['tabular-nums'] },
  listBook: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.item, borderBottomColor: tokens.colors.separator, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: tokens.spacing.item },
  listCoverWrap: { position: 'relative' },
  listMetadata: { flex: 1, gap: 2 },
  listTitle: { color: tokens.colors.label, fontSize: tokens.typography.bookTitle, fontWeight: '600', lineHeight: 21 },
  listState: { color: tokens.colors.secondaryLabel, fontSize: 14, fontVariant: ['tabular-nums'] },
  cover: { justifyContent: 'space-between', overflow: 'hidden', padding: tokens.spacing.item, borderCurve: 'continuous', borderRadius: tokens.radius.cover },
  coverAccent: { width: 28, height: 3, backgroundColor: 'rgba(255,255,255,0.52)', borderRadius: 2 },
  coverTitle: { fontSize: 18, fontWeight: '700', lineHeight: 23, letterSpacing: -0.25 },
  coverAuthor: { fontSize: 11, fontWeight: '500', opacity: 0.78 },
  coverTitleLight: { color: '#FFFFFF' },
  coverTitleDark: { color: '#2C2C2E' },
  coverGeneratedLabel: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  selectionRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.compact, minHeight: 44 },
  selectionGridItem: { minHeight: 44, position: 'relative' },
  selectionGridIndicator: { position: 'absolute', zIndex: 1, left: tokens.spacing.compact, top: tokens.spacing.compact },
  selectionContent: { flex: 1 },
  selectionIndicator: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: tokens.colors.tertiaryLabel, backgroundColor: tokens.colors.background },
  selectionIndicatorSelected: { borderColor: tokens.colors.blue, backgroundColor: tokens.colors.blue },
  gridHandle: { alignSelf: 'flex-end', color: tokens.colors.secondaryLabel, fontSize: 19, marginTop: -26 },
  listHandle: { color: tokens.colors.secondaryLabel, fontSize: 24, paddingHorizontal: tokens.spacing.compact },
  emptyState: { flex: 1, minHeight: 440, justifyContent: 'center', alignItems: 'center', gap: tokens.spacing.compact, paddingBottom: 72 },
  emptySymbol: { color: tokens.colors.secondaryLabel, fontSize: 50, marginBottom: tokens.spacing.compact },
  emptyTitle: { color: tokens.colors.label, fontSize: tokens.typography.sectionTitle, fontWeight: '700' },
  emptyDescription: { color: tokens.colors.secondaryLabel, fontSize: tokens.typography.metadata },
  importButton: { minHeight: 44, borderRadius: 22, backgroundColor: tokens.colors.blue, justifyContent: 'center', paddingHorizontal: tokens.spacing.section, marginTop: tokens.spacing.item },
  importButtonText: { color: '#FFFFFF', fontSize: tokens.typography.body, fontWeight: '600' },
  noResults: { color: tokens.colors.secondaryLabel, fontSize: tokens.typography.metadata, paddingVertical: tokens.spacing.section, textAlign: 'center' },
});
