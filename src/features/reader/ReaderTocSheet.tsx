import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  frame,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import type { ReaderBookmark } from './bookmark-repository';
import type { ReaderLocation, ReaderTocItem } from './reader-types';

const TOC_ROW_HEIGHT = 58;
const TOC_FLOATING_HEADER_HEIGHT = 80;
const MODE_CROSSFADE_MS = 140;

export type ReaderNavigationMode = 'toc' | 'bookmarks';

type FlatTocItem = ReaderTocItem & {
  depth: number;
  key: string;
  startPage: number | null;
};

type Props = {
  bookmarks: ReaderBookmark[];
  bookTitle: string;
  currentLocation: ReaderLocation | null;
  isNavigating: boolean;
  isPresented: boolean;
  onDismissed: () => void;
  onRequestDismiss: () => void;
  onSelect: (item: ReaderTocItem) => void;
  onSelectBookmark: (bookmark: ReaderBookmark) => void;
  pageByDestination: Record<string, number>;
  toc: ReaderTocItem[];
};

function flattenToc(items: ReaderTocItem[], pageByDestination: Record<string, number>, depth = 0, parentKey = 'root'): FlatTocItem[] {
  return items.flatMap((item, index) => {
    const key = item.id !== null ? `toc-${item.id}` : `${parentKey}-${index}-${item.href}`;
    const startPage = pageByDestination[item.href] ?? null;
    const flat: FlatTocItem = { ...item, depth, key, startPage };
    return [flat, ...flattenToc(item.subitems ?? [], pageByDestination, depth + 1, key)];
  });
}

function getBookmarkPage(bookmark: ReaderBookmark, pageByDestination: Record<string, number>) {
  return pageByDestination[bookmark.cfi] ?? null;
}

function findCurrentIndex(items: FlatTocItem[], location: ReaderLocation | null) {
  if (!location) return -1;
  if (location.tocItemId !== null) {
    const exactIndex = items.findIndex((item) => item.id === location.tocItemId);
    if (exactIndex >= 0) return exactIndex;
  }
  let nearest = -1;
  for (let index = 0; index < items.length; index += 1) {
    const spineIndex = items[index].spineIndex;
    if (spineIndex !== null && spineIndex <= location.spineIndex) nearest = index;
  }
  return nearest;
}

function TocHeader({ bookTitle, location }: { bookTitle: string; location: ReaderLocation | null }) {
  const pageLabel = location?.currentPage !== null
    && location?.currentPage !== undefined
    && location.totalPages !== null
    ? `${location.currentPage} / ${location.totalPages}`
    : null;
  return (
    <View style={styles.headerContent}>
      <Text numberOfLines={1} style={styles.headerTitle}>{bookTitle}</Text>
      {pageLabel ? <Text style={styles.headerPage}>{pageLabel}</Text> : null}
    </View>
  );
}

function BookmarkHeader({ count }: { count: number }) {
  return (
    <View style={styles.headerContent}>
      <Text numberOfLines={1} style={styles.headerTitle}>{uiText.navigation.bookmarks}</Text>
      <Text style={styles.headerPage}>{uiText.navigation.bookmarkCount(count)}</Text>
    </View>
  );
}

function ModeButton({ disabled, mode, onPress }: { disabled: boolean; mode: ReaderNavigationMode; onPress: () => void }) {
  const accessibilityLabel = mode === 'toc' ? uiText.navigation.showBookmarks : uiText.navigation.returnToToc;
  const icon = mode === 'toc' ? 'bookmark' : 'list.bullet';
  const content = (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={styles.modeButtonContent}
    >
      <SymbolView name={icon} size={21} tintColor={tokens.colors.label} weight="semibold" />
    </Pressable>
  );
  if (isGlassEffectAPIAvailable()) {
    return (
      <GlassView colorScheme="light" glassEffectStyle="regular" isInteractive style={styles.modeButton}>
        {content}
      </GlassView>
    );
  }
  return <View style={[styles.modeButton, styles.modeButtonFallback]}>{content}</View>;
}

function formatBookmarkDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function BookmarkRow({
  bookmark,
  disabled,
  onSelect,
  page,
}: {
  bookmark: ReaderBookmark;
  disabled: boolean;
  onSelect: (bookmark: ReaderBookmark) => void;
  page: number | null;
}) {
  const date = formatBookmarkDate(bookmark.createdAt);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onSelect(bookmark)}
      style={({ pressed }) => [styles.bookmarkRow, pressed && !disabled ? styles.rowPressed : null]}
    >
      <View style={styles.bookmarkTopLine}>
        <Text numberOfLines={1} style={styles.bookmarkChapter}>{bookmark.chapterTitle || uiText.navigation.unnamedLocation}</Text>
        {page !== null ? <Text style={styles.bookmarkPage}>{page}</Text> : null}
      </View>
      {bookmark.excerpt ? <Text numberOfLines={2} style={styles.bookmarkExcerpt}>{bookmark.excerpt}</Text> : null}
      {date ? <Text style={styles.bookmarkDate}>{date}</Text> : null}
    </Pressable>
  );
}

export function ReaderTocSheet({
  bookmarks,
  bookTitle,
  currentLocation,
  isNavigating,
  isPresented,
  onDismissed,
  onRequestDismiss,
  onSelect,
  onSelectBookmark,
  pageByDestination,
  toc,
}: Props) {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<FlatTocItem>>(null);
  const didAutoScrollRef = useRef(false);
  const modeProgress = useRef(new Animated.Value(0)).current;
  const [mode, setMode] = useState<ReaderNavigationMode>('toc');
  const [modeSwitching, setModeSwitching] = useState(false);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  // 打开目录时先隐藏列表，等滚动到当前章节居中后再显示，避免用户看到"先在顶部、再跳到中间"的闪动
  const [tocHidden, setTocHidden] = useState(true);
  const flatToc = useMemo(() => flattenToc(toc, pageByDestination), [pageByDestination, toc]);
  const currentIndex = useMemo(() => findCurrentIndex(flatToc, currentLocation), [currentLocation, flatToc]);
  const centerInset = Math.max(0, (listViewportHeight - TOC_ROW_HEIGHT) / 2);
  const rowsBeforeCurrent = currentIndex >= 0 ? currentIndex : 0;
  const rowsAfterCurrent = currentIndex >= 0 ? Math.max(0, flatToc.length - currentIndex - 1) : 0;
  const listTopPadding = Math.max(TOC_FLOATING_HEADER_HEIGHT, centerInset - rowsBeforeCurrent * TOC_ROW_HEIGHT);
  const listBottomPadding = currentIndex >= 0 ? Math.max(0, centerInset - rowsAfterCurrent * TOC_ROW_HEIGHT) : 0;
  const tocOpacity = modeProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const bookmarkOpacity = modeProgress;

  useLayoutEffect(() => {
    if (!isPresented) {
      didAutoScrollRef.current = false;
      return;
    }
    didAutoScrollRef.current = false;
    // 同步在绘制前隐藏，避免闪出未居中的初始位置
    setTocHidden(true);
    modeProgress.stopAnimation();
    modeProgress.setValue(0);
    setMode('toc');
    setModeSwitching(false);
  }, [isPresented, modeProgress]);

  const scrollToCurrent = useCallback(() => {
    if (!isPresented || mode !== 'toc' || currentIndex < 0 || listViewportHeight <= 0 || didAutoScrollRef.current) {
      return undefined;
    }
    // BottomSheet 是原生 sheet：isPresented=true 到动画播完、列表真正量好高度需要几百毫秒。
    // 旧代码只等一帧（16ms）就滚，原生 scrollToOffset 会静默失败，而标记已提前设为 true，导致永不重试。
    // 改为延迟到动画完成后执行，成功执行后才标记。
    const timer = setTimeout(() => {
      const list = listRef.current;
      if (!list) {
        // 极端情况：拿不到列表引用也要显示出来，不能一直空白
        setTocHidden(false);
        return;
      }
      const itemOffset = listTopPadding + currentIndex * TOC_ROW_HEIGHT;
      const centeredOffset = Math.max(0, itemOffset - centerInset);
      list.scrollToOffset({ animated: false, offset: centeredOffset });
      didAutoScrollRef.current = true;
      // 滚动是同步生效的，下一帧显示时已经是居中好的位置
      requestAnimationFrame(() => setTocHidden(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [centerInset, currentIndex, isPresented, listTopPadding, listViewportHeight, mode]);

  useEffect(() => {
    if (!isPresented) return undefined;
    const cleanup = scrollToCurrent();
    // 兜底：1.2 秒后强制显示，避免任何极端情况下列表一直空白
    const fallback = setTimeout(() => setTocHidden(false), 1200);
    return () => {
      cleanup?.();
      clearTimeout(fallback);
    };
  }, [isPresented, scrollToCurrent]);

  const toggleMode = useCallback(() => {
    if (modeSwitching) return;
    const nextMode: ReaderNavigationMode = mode === 'toc' ? 'bookmarks' : 'toc';
    setMode(nextMode);
    setModeSwitching(true);
    Animated.timing(modeProgress, {
      duration: MODE_CROSSFADE_MS,
      toValue: nextMode === 'bookmarks' ? 1 : 0,
      useNativeDriver: true,
    }).start(() => setModeSwitching(false));
  }, [mode, modeProgress, modeSwitching]);

  const renderTocItem = useCallback(({ item, index }: { item: FlatTocItem; index: number }) => {
    const isCurrent = index === currentIndex;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isNavigating, selected: isCurrent }}
        disabled={isNavigating}
        onPress={() => onSelect(item)}
        style={({ pressed }) => [styles.tocRow, pressed && !isNavigating ? styles.rowPressed : null]}
      >
        <Text numberOfLines={2} style={[styles.tocLabel, isCurrent ? styles.tocCurrent : null, isCurrent ? styles.tocLabelCurrent : null]}>{item.label}</Text>
        {item.startPage !== null ? <Text style={[styles.tocPage, isCurrent ? styles.tocCurrent : null]}>{item.startPage}</Text> : null}
      </Pressable>
    );
  }, [currentIndex, isNavigating, onSelect]);

  const renderBookmark = useCallback(({ item }: { item: ReaderBookmark }) => {
    const page = getBookmarkPage(item, pageByDestination);
    return (
      <BookmarkRow
        bookmark={item}
        disabled={isNavigating}
        onSelect={onSelectBookmark}
        page={page}
      />
    );
  }, [isNavigating, onSelectBookmark, pageByDestination]);

  return (
    <Host pointerEvents="none" style={styles.sheetHost}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismissed}
        onIsPresentedChange={(presented) => { if (!presented) onRequestDismiss(); }}
      >
        <Group modifiers={[
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
          presentationDetents(['medium', 'large']),
          presentationDragIndicator('visible'),
          presentationBackground('transparent'),
        ]}>
          <RNHostView>
            <View style={styles.sheetContent}>
              {isGlassEffectAPIAvailable() ? (
                <GlassView colorScheme="light" glassEffectStyle="clear" pointerEvents="none" style={[StyleSheet.absoluteFill, { bottom: -insets.bottom }]} />
              ) : (
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.sheetGlassFallback, { bottom: -insets.bottom }]} />
              )}

              <Animated.View accessibilityElementsHidden={mode !== 'toc'} importantForAccessibility={mode === 'toc' ? 'auto' : 'no-hide-descendants'} pointerEvents={mode === 'toc' ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { opacity: tocOpacity }]}>
                <FlatList
                  contentContainerStyle={flatToc.length ? [styles.listContent, { paddingBottom: listBottomPadding, paddingTop: listTopPadding }] : styles.emptyListContent}
                  data={flatToc}
                  getItemLayout={(_, index) => ({ index, length: TOC_ROW_HEIGHT, offset: listTopPadding + TOC_ROW_HEIGHT * index })}
                  initialNumToRender={18}
                  keyExtractor={(item) => item.key}
                  ListEmptyComponent={<View style={styles.emptyState}><SymbolView name="list.bullet" size={28} tintColor="#8e8e93" weight="regular" /><Text style={styles.emptyText}>{uiText.navigation.noToc}</Text></View>}
                  onLayout={(event) => setListViewportHeight(event.nativeEvent.layout.height)}
                  ref={listRef}
                  removeClippedSubviews
                  renderItem={renderTocItem}
                  nestedScrollEnabled
                  style={[styles.list, { marginBottom: -insets.bottom, opacity: tocHidden ? 0 : 1 }]}
                  windowSize={9}
                />
              </Animated.View>

              <Animated.View accessibilityElementsHidden={mode !== 'bookmarks'} importantForAccessibility={mode === 'bookmarks' ? 'auto' : 'no-hide-descendants'} pointerEvents={mode === 'bookmarks' ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { opacity: bookmarkOpacity }]}>
                <FlatList
                  contentContainerStyle={bookmarks.length ? [styles.bookmarkListContent, { paddingBottom: Math.max(20, insets.bottom), paddingTop: TOC_FLOATING_HEADER_HEIGHT }] : styles.emptyListContent}
                  data={bookmarks}
                  initialNumToRender={12}
                  keyExtractor={(item) => `bookmark-${item.id}`}
                  ListEmptyComponent={<View style={styles.emptyState}><SymbolView name="bookmark" size={27} tintColor="#8e8e93" weight="regular" /><Text style={styles.emptyText}>{uiText.navigation.noBookmarks}</Text><Text style={styles.emptyDetail}>{uiText.navigation.noBookmarksDetail}</Text></View>}
                  renderItem={renderBookmark}
                  nestedScrollEnabled
                  style={[styles.list, { marginBottom: -insets.bottom }]}
                  windowSize={8}
                />
              </Animated.View>

              <View pointerEvents="box-none" style={styles.floatingHeader}>
                <View pointerEvents="none" style={styles.headerStack}>
                  <Animated.View style={[StyleSheet.absoluteFill, { opacity: tocOpacity }]}><TocHeader bookTitle={bookTitle} location={currentLocation} /></Animated.View>
                  <Animated.View style={[StyleSheet.absoluteFill, { opacity: bookmarkOpacity }]}><BookmarkHeader count={bookmarks.length} /></Animated.View>
                </View>
                <View style={styles.modeButtonContainer}><ModeButton disabled={modeSwitching} mode={mode} onPress={toggleMode} /></View>
              </View>
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  sheetHost: { position: 'absolute' },
  sheetContent: { flexGrow: 1, height: 0 },
  sheetGlassFallback: { backgroundColor: 'rgba(246,246,250,0.82)' },
  floatingHeader: { height: 68, left: 16, position: 'absolute', right: 16, top: 8, zIndex: 2 },
  headerStack: { height: 68, paddingHorizontal: 56 },
  headerContent: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 8 },
  headerTitle: { color: tokens.colors.label, fontSize: 17, fontWeight: '600', lineHeight: 22, textAlign: 'center' },
  headerPage: { color: tokens.colors.secondaryLabel, fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '500', lineHeight: 18, marginTop: 2, textAlign: 'center' },
  modeButtonContainer: { height: 46, position: 'absolute', right: 1, top: 11, width: 46 },
  modeButton: { borderRadius: 23, height: 46, overflow: 'hidden', width: 46 },
  modeButtonFallback: { backgroundColor: 'rgba(250,250,252,0.76)', borderColor: 'rgba(60,60,67,0.12)', borderWidth: StyleSheet.hairlineWidth },
  modeButtonContent: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12 },
  bookmarkListContent: { paddingHorizontal: 12 },
  tocRow: { alignItems: 'center', borderBottomColor: 'rgba(60,60,67,0.12)', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, height: TOC_ROW_HEIGHT, justifyContent: 'center', paddingLeft: 22, paddingRight: 18 },
  rowPressed: { backgroundColor: 'rgba(60,60,67,0.08)', borderRadius: 12 },
  tocLabel: { color: tokens.colors.label, flex: 1, fontSize: 16, fontWeight: '500', lineHeight: 20 },
  tocCurrent: { color: tokens.colors.blue, opacity: 0.82 },
  tocLabelCurrent: { fontWeight: '600' },
  tocPage: { color: tokens.colors.secondaryLabel, fontSize: 15, fontVariant: ['tabular-nums'], fontWeight: '500' },
  bookmarkRow: { borderBottomColor: 'rgba(60,60,67,0.12)', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 86, paddingHorizontal: 22, paddingVertical: 12 },
  bookmarkTopLine: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  bookmarkChapter: { color: tokens.colors.label, flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  bookmarkPage: { color: tokens.colors.secondaryLabel, fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '500' },
  bookmarkExcerpt: { color: tokens.colors.secondaryLabel, fontSize: 14, lineHeight: 19, marginTop: 4 },
  bookmarkDate: { color: tokens.colors.tertiaryLabel, fontSize: 12, lineHeight: 16, marginTop: 3 },
  emptyListContent: { flexGrow: 1 },
  emptyState: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center', paddingBottom: 44 },
  emptyText: { color: tokens.colors.secondaryLabel, fontSize: 15, fontWeight: '500' },
  emptyDetail: { color: tokens.colors.tertiaryLabel, fontSize: 13, fontWeight: '400' },
});
