import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, AppState, Dimensions, Linking, Pressable, ScrollView, StyleSheet, Text, TextStyle, useWindowDimensions, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { AnimatedStyle, cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { isReaderEditMenuNativeAvailable } from '../../../modules/reader-edit-menu';
import {
  addNativeFootnotePopoverDismissListener,
  dismissFootnotePopover as dismissNativeFootnotePopover,
  isNativeReaderPopoverAvailable,
  presentFootnotePopover as presentNativeFootnotePopover,
} from '../../../modules/reader-popover';
import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import { BookCoverArt } from '../library/BookCoverArt';
import type { CoverTone } from '../library/library-types';
import { bookmarkRepository, type ReaderBookmark } from './bookmark-repository';
import { bookSearchHistoryRepository, type BookSearchHistoryItem } from './book-search-history-repository';
import { excerptRepository } from './excerpt-repository';
import { highlightRepository } from './highlight-repository';
import type { ReaderHighlightSnapshotItem } from './highlight-repository';
import type {
  FootnoteAnchorRect,
  FootnotePayload,
  FootnoteRichTextNode,
  ReaderBookmarkNavigationRequest,
  ReaderBookmarkSnapshot,
  ReaderBookmarkSnapshotRequest,
  ReaderLocation,
  ReaderPageLocationRequest,
  ReaderPageLocationResult,
  ReaderRestoreState,
  ReaderSearchNavigationRequest,
  ReaderSearchRequest,
  ReaderSearchResult,
  ReaderSearchInitialQueryRequest,
  ReaderExcerptVerificationRequest,
  ReaderSelectionActionEvent,
  ReaderSelectionCommand,
  ReaderSelectionPayload,
  ReaderTextMeasureRequest,
  ReaderTextMeasureResult,
  ReaderTocItem,
  ReaderTocNavigationRequest,
} from './reader-types';
import { markReaderOpen } from './reader-open-performance';
import { READING_SESSION_MEASURE_TIMEOUT_MS } from './reading-session-tracker';
import { useReadingSessionTracker } from './use-reading-session-tracker';
import { DEFAULT_READER_SETTINGS, READER_SETTINGS_LIMITS } from './reader-settings';
import FoliateReaderDom from './FoliateReaderDom';
import { ReaderSearchSheet } from './ReaderSearchSheet';
import { ReaderSettingsSheet } from './ReaderSettingsSheet';
import { ReaderTocSheet } from './ReaderTocSheet';
import { useReaderController } from './use-reader-controller';

const CONTROL_BAR_WIDTH = 232;
const CONTROL_BAR_HEIGHT = 52;
const HEADER_ACTION_SIZE = 44;
const BOOK_TITLE_LINE_HEIGHT = 20;
const READER_HEADER_SAFE_TOP_GAP = 2;
const PAGE_INDICATOR_FADE_OUT_MS = 96;
const PAGE_INDICATOR_FADE_IN_MS = 144;
const READER_OPENING_COVER_FADE_MS = 300;
const EXCERPT_ACTION_WIDTH = 72;
const EXCERPT_ACTION_HEIGHT = 40;
const EXCERPT_ACTION_EDGE_GAP = 12;
const EXCERPT_ACTION_SELECTION_GAP = 10;
const FOOTNOTE_POPOVER_WIDTH_RATIO = 0.76;
const FOOTNOTE_POPOVER_MAX_HEIGHT_RATIO = 0.42;
const FOOTNOTE_POPOVER_EDGE_GAP = 12;
const FOOTNOTE_POPOVER_ANCHOR_GAP = 8;
const FOOTNOTE_POPOVER_MIN_HEIGHT = 96;
const FOOTNOTE_POPOVER_FONT_SIZE = 14;

const readerOpeningCoverTones = new Set<CoverTone>(['paper', 'coral', 'mist', 'ink', 'sage', 'plum', 'ocean']);

function firstRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function collectTocPageTargets(items: ReaderTocItem[], targets: Map<string, string>) {
  for (const item of items) {
    if (item.href) targets.set(item.href, `toc:${item.id ?? item.href}`);
    if (item.subitems?.length) collectTocPageTargets(item.subitems, targets);
  }
}

function ReaderGlassButton({
  accessibilityLabel,
  animationDuration,
  contentOpacityStyle,
  glassVisible,
  icon,
  interactive,
  colorScheme,
  tintColor,
  fallbackColor,
  onLayout,
  onPress,
}: {
  accessibilityLabel: string;
  animationDuration: number;
  contentOpacityStyle: AnimatedStyle<ViewStyle>;
  glassVisible: boolean;
  icon: 'xmark';
  interactive: boolean;
  colorScheme: 'light' | 'dark';
  tintColor: string;
  fallbackColor: string;
  onLayout: () => void;
  onPress: () => void;
}) {
  const button = <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" disabled={!interactive} hitSlop={10} onPress={onPress} style={styles.glassButtonContent}><SymbolView name={icon} size={21} tintColor={tintColor} weight="semibold" /></Pressable>;

  if (isGlassEffectAPIAvailable()) {
    return (
      <GlassView
        accessibilityElementsHidden={!interactive}
        colorScheme={colorScheme}
        glassEffectStyle={{ animate: true, animationDuration, style: glassVisible ? 'regular' : 'none' }}
        importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
        isInteractive
        onLayout={onLayout}
        pointerEvents={interactive ? 'auto' : 'none'}
        style={styles.glassButton}
      >
        <Animated.View style={[styles.glassButtonContent, contentOpacityStyle]}>{button}</Animated.View>
      </GlassView>
    );
  }
  return <Animated.View accessibilityElementsHidden={!interactive} importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'} onLayout={onLayout} pointerEvents={interactive ? 'auto' : 'none'} style={[styles.glassButtonFallback, { backgroundColor: fallbackColor }, contentOpacityStyle]}>{button}</Animated.View>;
}

function ReaderControlEntry({
  disabled = false,
  label,
  icon,
  onPress,
  selected = false,
  tintColor,
}: {
  disabled?: boolean;
  label: string;
  icon: 'list.bullet' | 'magnifyingglass' | 'gearshape' | 'bookmark' | 'bookmark.fill';
  onPress?: () => void;
  selected?: boolean;
  tintColor: string;
}) {
  const content = (
    <>
      <SymbolView name={icon} size={22} tintColor={tintColor} weight="semibold" />
    </>
  );
  if (onPress) {
    return (
      <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={styles.readerControlButton}>
        {content}
      </Pressable>
    );
  }
  return <View accessibilityElementsHidden style={styles.readerControlButton}>{content}</View>;
}

function ReaderControlBar({
  animationDuration,
  bookmarkBusy,
  contentOpacityStyle,
  currentBookmarked,
  glassVisible,
  interactive,
  colorScheme,
  tintColor,
  fallbackColor,
  onLayout,
  onBookmarkPress,
  onSearchPress,
  onSettingsPress,
  onTocPress,
}: {
  animationDuration: number;
  contentOpacityStyle: AnimatedStyle<ViewStyle>;
  glassVisible: boolean;
  interactive: boolean;
  colorScheme: 'light' | 'dark';
  tintColor: string;
  fallbackColor: string;
  onLayout: () => void;
  onBookmarkPress: () => void;
  onSearchPress: () => void;
  onSettingsPress: () => void;
  onTocPress: () => void;
  bookmarkBusy: boolean;
  currentBookmarked: boolean;
}) {
  const controls: Array<{ label: string; icon: 'list.bullet' | 'magnifyingglass' | 'gearshape' | 'bookmark' | 'bookmark.fill'; onPress?: () => void; disabled?: boolean; selected?: boolean }> = [
    { label: uiText.reader.toc, icon: 'list.bullet', onPress: onTocPress },
    { label: uiText.reader.search, icon: 'magnifyingglass', onPress: onSearchPress },
    { label: uiText.reader.settings, icon: 'gearshape', onPress: onSettingsPress },
    { label: currentBookmarked ? uiText.reader.removeBookmark : uiText.reader.addBookmark, icon: currentBookmarked ? 'bookmark.fill' : 'bookmark', onPress: onBookmarkPress, disabled: bookmarkBusy, selected: currentBookmarked },
  ];
  const content = controls.map((control) => <ReaderControlEntry disabled={control.disabled} icon={control.icon} key={control.label} label={control.label} onPress={control.onPress} selected={control.selected} tintColor={tintColor} />);

  return (
    isGlassEffectAPIAvailable() ? (
      <GlassView
        accessibilityElementsHidden={!interactive}
        colorScheme={colorScheme}
        glassEffectStyle={{ animate: true, animationDuration, style: glassVisible ? 'regular' : 'none' }}
        importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
        isInteractive
        onLayout={onLayout}
        pointerEvents={interactive ? 'auto' : 'none'}
        style={styles.readerControlBar}
      >
        <Animated.View accessibilityLabel={uiText.reader.controls} style={[styles.readerControlBarContent, contentOpacityStyle]}>{content}</Animated.View>
      </GlassView>
    ) : (
      <Animated.View
        accessibilityElementsHidden={!interactive}
        importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
        onLayout={onLayout}
        pointerEvents={interactive ? 'auto' : 'none'}
        style={[styles.readerControlBarFallback, { backgroundColor: fallbackColor }, contentOpacityStyle]}
      >
        <View accessibilityLabel={uiText.reader.controls} style={styles.readerControlBarContent}>{content}</View>
      </Animated.View>
    )
  );
}

function ReaderPageIndicator({
  location,
  totalOpacityStyle,
  color,
}: {
  location: ReaderLocation | null;
  totalOpacityStyle: AnimatedStyle<TextStyle>;
  color: string;
}) {
  // `renderer.page` is useful as the current reading page, but it is only
  // chapter-local until the completed whole-book cache supplies a total. Keep
  // that page visible; only append the total while Reader Chrome is visible.
  // Before the whole-book cache is ready, `currentPage` is only foliate's
  // section-local page. Do not expose that transient number as a global page.
  if (
    location?.currentPage === null
    || location?.currentPage === undefined
    || location.totalPages === null
  ) return null;
  return (
    <View pointerEvents="none" style={styles.positionContainer}>
      <Text style={[styles.positionText, { color }]}>{location.currentPage}</Text>
      {location.totalPages !== null ? (
        <Animated.Text style={[styles.positionText, { color }, totalOpacityStyle]}> / {location.totalPages}</Animated.Text>
      ) : null}
    </View>
  );
}

function ReaderExcerptAction({
  colorScheme,
  disabled,
  fallbackColor,
  left,
  onPress,
  onPressIn,
  onPressOut,
  textColor,
  top,
}: {
  colorScheme: 'light' | 'dark';
  disabled: boolean;
  fallbackColor: string;
  left: number;
  onPress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
  textColor: string;
  top: number;
}) {
  const content = (
    <Pressable
      accessibilityLabel={uiText.reader.excerptSelection}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={styles.excerptActionContent}
    >
      <Text style={[styles.excerptActionText, { color: textColor, opacity: disabled ? 0.48 : 1 }]}>{uiText.reader.excerpt}</Text>
    </Pressable>
  );

  return (
    <View pointerEvents="box-none" style={[styles.excerptActionPosition, { left, top }]}>
      {isGlassEffectAPIAvailable() ? (
        <GlassView colorScheme={colorScheme} glassEffectStyle="regular" isInteractive style={styles.excerptActionGlass}>
          {content}
        </GlassView>
      ) : (
        <View style={[styles.excerptActionFallback, { backgroundColor: fallbackColor }]}>{content}</View>
      )}
    </View>
  );
}

function renderFootnoteNodes(nodes: FootnoteRichTextNode[], linkColor: string, keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.kind) {
      case 'text':
        return <Text key={key}>{node.text}</Text>;
      case 'em':
        return <Text key={key} style={{ fontStyle: 'italic' }}>{renderFootnoteNodes(node.children, linkColor, key)}</Text>;
      case 'strong':
        return <Text key={key} style={{ fontWeight: '600' }}>{renderFootnoteNodes(node.children, linkColor, key)}</Text>;
      case 'break':
        return <Text key={key}>{'\n'}</Text>;
      case 'paragraph':
        return <Text key={key}>{renderFootnoteNodes(node.children, linkColor, key)}{'\n\n'}</Text>;
      case 'link': {
        const tappable = /^https?:/i.test(node.href);
        return (
          <Text
            key={key}
            onPress={tappable ? () => { void Linking.openURL(node.href).catch(() => {}); } : undefined}
            style={tappable ? { color: linkColor } : undefined}
          >
            {renderFootnoteNodes(node.children, linkColor, key)}
          </Text>
        );
      }
    }
  });
}

function FootnotePopover({
  colorScheme,
  fallbackColor,
  layout,
  linkColor,
  onDismiss,
  payload,
  textColor,
}: {
  colorScheme: 'light' | 'dark';
  fallbackColor: string;
  layout: { left: number; width: number; maxHeight: number } & ({ top: number } | { bottom: number });
  linkColor: string;
  onDismiss: () => void;
  payload: FootnotePayload;
  textColor: string;
}) {
  const positionStyle = 'top' in layout
    ? { bottom: undefined, left: layout.left, top: layout.top, width: layout.width }
    : { bottom: layout.bottom, left: layout.left, top: undefined, width: layout.width };
  const content = (
    <ScrollView
      contentContainerStyle={styles.footnotePopoverScrollContent}
      scrollIndicatorInsets={{ right: 1 }}
      showsVerticalScrollIndicator={false}
      style={{ maxHeight: layout.maxHeight }}
    >
      <Text
        accessibilityLabel={payload.text}
        style={[styles.footnotePopoverText, { color: textColor }]}
      >
        {renderFootnoteNodes(payload.richText, linkColor, 'fn')}
      </Text>
    </ScrollView>
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Outside tap dismisses only; the pressable covers the WebView so the
          tap never reaches the reader (no page turn, no chrome toggle). */}
      <Pressable
        accessibilityHint={uiText.reader.dismissFootnoteHint}
        accessibilityLabel={uiText.reader.dismissFootnote}
        accessibilityRole="button"
        onPress={onDismiss}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.footnotePopoverPosition, positionStyle]}>
        {isGlassEffectAPIAvailable() ? (
          <GlassView colorScheme={colorScheme} glassEffectStyle="regular" isInteractive style={styles.footnotePopoverGlass}>
            {content}
          </GlassView>
        ) : (
          <View style={[styles.footnotePopoverFallback, { backgroundColor: fallbackColor }]}>{content}</View>
        )}
      </View>
    </View>
  );
}

export default function ReaderScreen() {
  const routeParams = useLocalSearchParams<{
    bookId: string | string[];
    openingAuthor?: string | string[];
    openingBackground?: string | string[];
    openingCoverTone?: string | string[];
    openingCoverUri?: string | string[];
    openingGenerated?: string | string[];
    openingTitle?: string | string[];
  }>();
  const bookId = firstRouteParam(routeParams.bookId);
  const { height: readerViewportHeight, width: readerViewportWidth } = useWindowDimensions();
  const openingTitle = firstRouteParam(routeParams.openingTitle) ?? '';
  const openingAuthor = firstRouteParam(routeParams.openingAuthor) || null;
  const openingBackground = firstRouteParam(routeParams.openingBackground) || tokens.colors.background;
  const openingCoverUri = firstRouteParam(routeParams.openingCoverUri) || null;
  const rawOpeningCoverTone = firstRouteParam(routeParams.openingCoverTone) as CoverTone | undefined;
  const openingCoverTone = rawOpeningCoverTone && readerOpeningCoverTones.has(rawOpeningCoverTone) ? rawOpeningCoverTone : 'ink';
  const openingGenerated = firstRouteParam(routeParams.openingGenerated) === '1';
  const readerLaunchCoverWidth = Math.min(240, readerViewportWidth * 0.65);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const controller = useReaderController(bookId);
  const readerAppearance = controller.appliedReaderSettings.appearance;
  const readerColors = readerAppearance === 'dark'
    ? { background: '#151517', primary: '#f2f2f7', secondary: '#aeaeb2', glassFallback: 'rgba(44,44,46,0.88)', link: '#64d2ff' }
    : { background: tokens.colors.background, primary: '#171719', secondary: '#8b8b90', glassFallback: 'rgba(250,250,252,0.88)', link: '#007aff' };
  const chromeVisibleRef = useRef(false);
  // Latest setReaderChromeVisible for callbacks declared before it (e.g.
  // handleFootnoteOpen). Assigned in an effect below; footnote taps call
  // through this ref so they never summon reader chrome.
  const setReaderChromeVisibleRef = useRef<(visible: boolean) => void>(() => undefined);
  const displayedPageLocationRef = useRef<ReaderLocation | null>(null);
  const pageIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chromeMountedRef = useRef(false);
  const chromeLayoutsRef = useRef({ close: false, menu: false });
  const chromeRevealStartedRef = useRef(false);
  const chromeFadePendingRef = useRef(false);
  const chromeReadyFrameRef = useRef<number | null>(null);
  const pendingTocItemRef = useRef<ReaderTocItem | null>(null);
  const pendingBookmarkRef = useRef<ReaderBookmark | null>(null);
  const pendingSearchResultRef = useRef<ReaderSearchResult | null>(null);
  const tocRequestSequenceRef = useRef(0);
  const bookmarkSnapshotSequenceRef = useRef(0);
  const bookmarkNavigationSequenceRef = useRef(0);
  const pageLocationSequenceRef = useRef(0);
  const searchRequestSequenceRef = useRef(0);
  const searchNavigationSequenceRef = useRef(0);
  const searchInitialQuerySequenceRef = useRef(0);
  const activeSearchRequestRef = useRef<ReaderSearchRequest | null>(null);
  const activeBookmarkSnapshotRequestRef = useRef<ReaderBookmarkSnapshotRequest | null>(null);
  const activePageLocationRequestRef = useRef<ReaderPageLocationRequest | null>(null);
  const activeSelectionRef = useRef<ReaderSelectionPayload | null>(null);
  const excerptActionPayloadRef = useRef<ReaderSelectionPayload | null>(null);
  const excerptActionPressingRef = useRef(false);
  const excerptSavingRef = useRef(false);
  const highlightSavingRef = useRef(false);
  const selectionCommandSequenceRef = useRef(0);
  const excerptVerificationSequenceRef = useRef(0);
  const [highlightSnapshot, setHighlightSnapshot] = useState<ReaderHighlightSnapshotItem[] | null>(null);
  const [chromeMounted, setChromeMounted] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [chromeInteractive, setChromeInteractive] = useState(false);
  const [glassVisible, setGlassVisible] = useState(false);
  const [glassAnimationDuration, setGlassAnimationDuration] = useState(0.24);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [currentBookmarked, setCurrentBookmarked] = useState(false);
  const [tocSheetPresented, setTocSheetPresented] = useState(false);
  const [settingsSheetPresented, setSettingsSheetPresented] = useState(false);
  const [searchSheetPresented, setSearchSheetPresented] = useState(false);
  const [tocNavigating, setTocNavigating] = useState(false);
  const [tocNavigationRequest, setTocNavigationRequest] = useState<ReaderTocNavigationRequest | null>(null);
  const [bookmarkSnapshotRequest, setBookmarkSnapshotRequest] = useState<ReaderBookmarkSnapshotRequest | null>(null);
  const [bookmarkNavigationRequest, setBookmarkNavigationRequest] = useState<ReaderBookmarkNavigationRequest | null>(null);
  const [pageLocationRequest, setPageLocationRequest] = useState<ReaderPageLocationRequest | null>(null);
  const [pageByDestination, setPageByDestination] = useState<Record<string, number>>({});
  const [searchNavigationRequest, setSearchNavigationRequest] = useState<ReaderSearchNavigationRequest | null>(null);
  const [searchRequest, setSearchRequest] = useState<ReaderSearchRequest | null>(null);
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<BookSearchHistoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchComplete, setSearchComplete] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchInitialQueryRequest, setSearchInitialQueryRequest] = useState<ReaderSearchInitialQueryRequest | null>(null);
  const [activeSelection, setActiveSelection] = useState<ReaderSelectionPayload | null>(null);
  const [footnotePopover, setFootnotePopover] = useState<FootnotePayload | null>(null);
  // True while any footnote popover is on screen (native or RN fallback).
  // Forwarded to the DOM gesture layer as a plain prop so taps are classified
  // synchronously: while open, a tap only dismisses the popover and never
  // turns the page or toggles chrome. Updated at every open/close site below.
  const [footnoteModalOpen, setFootnoteModalOpen] = useState(false);
  // Anchor of the currently shown *native* footnote popover (null when none
  // or when the RN fallback overlay is used). System outside-tap dismisses
  // are reported back through the native dismiss event below.
  const nativeFootnoteAnchorRef = useRef<FootnoteAnchorRect | null>(null);
  // Reader root view; DEV-only coordinate verification measures its window
  // origin to prove the anchor math shares the window coordinate space.
  const readerRootRef = useRef<View>(null);

  const isSameFootnoteAnchor = (a: FootnoteAnchorRect, b: FootnoteAnchorRect) =>
    Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;

  // ── ReadingSession Core A ─────────────────────────────────────────────
  // Behavioral reading data layer (no formal UI in this phase). The tracker
  // owns session lifecycle, effective active time, idle detection and the
  // forward-character high-water mark; this screen only feeds it context,
  // activity signals, locations, and the text-measure bridge.
  const isFocused = useIsFocused();
  const readingSessionBlocked = tocSheetPresented || settingsSheetPresented || searchSheetPresented;

  const [textMeasureRequest, setTextMeasureRequest] = useState<ReaderTextMeasureRequest | null>(null);
  const textMeasureSequenceRef = useRef(0);
  const pendingTextMeasuresRef = useRef(new Map<string, (result: ReaderTextMeasureResult) => void>());

  // Resolves via the DOM bridge (adapter.measureForwardText). Always
  // resolves — a bridge timeout reports ok:false so the tracker's serial
  // queue can never stall on a lost response.
  const requestTextMeasure = useCallback(
    (fromCfi: string, toCfi: string): Promise<ReaderTextMeasureResult> => {
      const id = `tm-${++textMeasureSequenceRef.current}`;
      return new Promise<ReaderTextMeasureResult>((resolve) => {
        const timer = setTimeout(() => {
          pendingTextMeasuresRef.current.delete(id);
          setTextMeasureRequest((current) => (current?.id === id ? null : current));
          resolve({ id, ok: false, error: 'text measure timeout' });
        }, READING_SESSION_MEASURE_TIMEOUT_MS);
        pendingTextMeasuresRef.current.set(id, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        setTextMeasureRequest({ id, fromCfi, toCfi });
      });
    },
    [],
  );

  const handleTextMeasureResult = useCallback((result: ReaderTextMeasureResult) => {
    const resolve = pendingTextMeasuresRef.current.get(result.id);
    if (!resolve) return Promise.resolve();
    pendingTextMeasuresRef.current.delete(result.id);
    setTextMeasureRequest((current) => (current?.id === result.id ? null : current));
    resolve(result);
    return Promise.resolve();
  }, []);

  const readingSessionTrackerRef = useReadingSessionTracker({
    bookId: bookId ?? null,
    readerReady: controller.state.kind === 'ready',
    routeFocused: isFocused,
    blocked: readingSessionBlocked,
    requestTextMeasure,
  });

  const markReaderActivity = useCallback(() => {
    readingSessionTrackerRef.current.markActivity();
  }, [readingSessionTrackerRef]);

  // Feed every engine location to the session tracker before the controller
  // consumes it. The tracker only reads; it never mutates location state.
  const handleLocation = useCallback(async (
    location: ReaderLocation,
    restoreState: ReaderRestoreState,
  ) => {
    readingSessionTrackerRef.current.handleLocation(location, restoreState);
    await controller.onLocation(location, restoreState);
  }, [controller.onLocation, readingSessionTrackerRef]);

  // RN fallback overlay path: kept until the native popover is verified on a
  // real Development Build. Used only when the native module is unavailable
  // or native presentation throws. Never shown together with the native one.
  const openFootnoteFallbackOverlay = useCallback((payload: FootnotePayload) => {
    setFootnotePopover((current) => {
      if (
        current &&
        current.id === payload.id &&
        current.sourceHref === payload.sourceHref &&
        isSameFootnoteAnchor(current.anchorRect, payload.anchorRect)
      ) {
        // Re-tapping the same anchor toggles the popover closed.
        if (__DEV__) console.log('[FOOTNOTE_CLOSE]');
        setFootnoteModalOpen(false);
        return null;
      }
      setFootnoteModalOpen(true);
      return payload;
    });
  }, []);

  const handleFootnoteOpen = useCallback(async (payload: FootnotePayload) => {
    // Footnote open/close is reading activity; the popover itself does not
    // block active time (unlike TOC/search/settings sheets).
    markReaderActivity();
    // A footnote tap is a reading action, not a chrome action: opening the
    // popover must keep the reader in immersive mode. The tap's pointer-up
    // fires before the click is classified as a footnote, so a chrome toggle
    // from that same tap may already be in flight; force chrome hidden here
    // instead of racing that earlier toggle. This also covers the toggle-off
    // path below (re-tapping the marker never leaves chrome visible).
    if (chromeVisibleRef.current) {
      if (__DEV__) console.log('[FOOTNOTE_CHROME_HIDE]');
      setReaderChromeVisibleRef.current(false);
    }
    if (__DEV__) {
      // Empirical anchor-space check (no footnote content is logged). The
      // Reader root is flex:1 at window origin (0,0); if readerRootWindowRect
      // ever drifts from (0,0), the adapter's anchor math must be revisited
      // before trusting native popover alignment.
      readerRootRef.current?.measureInWindow((rx, ry, rw, rh) => {
        const { width: ww, height: wh } = Dimensions.get('window');
        console.log('[FOOTNOTE_COORD_VERIFY]', JSON.stringify({
          mappedRect: payload.anchorRect,
          readerRootWindowRect: {
            x: Math.round(rx * 100) / 100,
            y: Math.round(ry * 100) / 100,
            width: Math.round(rw),
            height: Math.round(rh),
          },
          windowSize: { width: Math.round(ww), height: Math.round(wh) },
          finalWindowRect: payload.anchorRect,
        }));
      });
    }
    if (isNativeReaderPopoverAvailable()) {
      const shown = nativeFootnoteAnchorRef.current;
      if (shown && isSameFootnoteAnchor(shown, payload.anchorRect)) {
        // Same noteref tapped again: toggle the native popover closed.
        // At most one native popover ever exists; never stack a second one.
        if (__DEV__) console.log('[FOOTNOTE_CLOSE]');
        nativeFootnoteAnchorRef.current = null;
        setFootnoteModalOpen(false);
        try {
          await dismissNativeFootnotePopover();
        } catch (error) {
          if (__DEV__) console.log('[FOOTNOTE_NATIVE_DISMISS_FAILED]', String(error));
        }
        return;
      }
      try {
        // payload.anchorRect is already in native window points
        // (FoliateEpubEngineAdapter.mapIframeRectToWebView). RN layout points
        // and UIKit layout points are the same unit: no scaling here.
        await presentNativeFootnotePopover({
          text: payload.text,
          anchor: payload.anchorRect,
          appearance: readerAppearance,
        });
        nativeFootnoteAnchorRef.current = payload.anchorRect;
        setFootnoteModalOpen(true);
        if (__DEV__) console.log('[FOOTNOTE_OPEN_NATIVE]');
        return;
      } catch (error) {
        // Native presentation failed: fall through to the RN overlay so the
        // tap is never swallowed silently. Never render both at once.
        nativeFootnoteAnchorRef.current = null;
        if (__DEV__) console.log('[FOOTNOTE_NATIVE_FAILED]', String(error));
      }
    }
    openFootnoteFallbackOverlay(payload);
  }, [markReaderActivity, readerAppearance, openFootnoteFallbackOverlay]);

  const dismissFootnotePopover = useCallback(() => {
    if (__DEV__) console.log('[FOOTNOTE_CLOSE]');
    markReaderActivity();
    // Clear native first, then the RN fallback state; at most one is ever set.
    nativeFootnoteAnchorRef.current = null;
    setFootnoteModalOpen(false);
    dismissNativeFootnotePopover().catch((error) => {
      if (__DEV__) console.log('[FOOTNOTE_NATIVE_DISMISS_FAILED]', String(error));
    });
    setFootnotePopover(null);
  }, [markReaderActivity]);

  // The system tells us when it dismisses the native popover on its own
  // (outside tap / swipe). The touch is consumed by the presentation, so it
  // never reaches reader gestures: the next tap behaves normally again.
  useEffect(() => {
    if (!isNativeReaderPopoverAvailable()) return;
    const subscription = addNativeFootnotePopoverDismissListener(() => {
      if (__DEV__) console.log('[FOOTNOTE_CLOSE]');
      nativeFootnoteAnchorRef.current = null;
      setFootnoteModalOpen(false);
    });
    return () => subscription.remove();
  }, []);

  // Never let a native popover outlive the reader route, the current book,
  // or the foreground session.
  useEffect(() => {
    return () => {
      nativeFootnoteAnchorRef.current = null;
      setFootnoteModalOpen(false);
      dismissNativeFootnotePopover().catch(() => undefined);
    };
  }, [bookId]);

  useEffect(() => {
    if (!isNativeReaderPopoverAvailable()) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        nativeFootnoteAnchorRef.current = null;
        setFootnoteModalOpen(false);
        dismissNativeFootnotePopover().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, []);

  // The footnote popover never floats above sheets; opening one dismisses it.
  useEffect(() => {
    if (tocSheetPresented || settingsSheetPresented || searchSheetPresented) {
      nativeFootnoteAnchorRef.current = null;
      dismissNativeFootnotePopover().catch(() => undefined);
      setFootnotePopover(null);
      setFootnoteModalOpen(false);
    }
  }, [tocSheetPresented, settingsSheetPresented, searchSheetPresented]);
  const [excerptSaving, setExcerptSaving] = useState(false);
  const [selectionCommand, setSelectionCommand] = useState<ReaderSelectionCommand | null>(null);
  const [excerptVerificationRequest, setExcerptVerificationRequest] = useState<ReaderExcerptVerificationRequest | null>(null);
  const [displayedPageLocation, setDisplayedPageLocation] = useState<ReaderLocation | null>(null);
  const [readerOpeningVisible, setReaderOpeningVisible] = useState(Boolean(openingTitle));
  const chromeProgress = useSharedValue(0);
  const pageIndicatorOpacity = useSharedValue(0);
  const readerOpeningOpacity = useSharedValue(openingTitle ? 1 : 0);

  useEffect(() => {
    const hasOpeningCover = Boolean(openingTitle);
    setReaderOpeningVisible(hasOpeningCover);
    readerOpeningOpacity.set(hasOpeningCover ? 1 : 0);
  }, [bookId, openingTitle, readerOpeningOpacity]);

  useEffect(() => {
    if (!readerOpeningVisible || (!controller.firstPageRendered && controller.state.kind !== 'error')) return;
    readerOpeningOpacity.set(withTiming(0, {
      duration: reduceMotion ? 90 : READER_OPENING_COVER_FADE_MS,
      easing: Easing.out(Easing.cubic),
    }, (finished) => {
      if (finished) runOnJS(setReaderOpeningVisible)(false);
    }));
  }, [controller.firstPageRendered, controller.state.kind, readerOpeningOpacity, readerOpeningVisible, reduceMotion]);

  const readerOpeningStyle = useAnimatedStyle(() => ({ opacity: readerOpeningOpacity.get() }));

  useEffect(() => {
    const nextLocation = controller.currentLocation;
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
  }, [controller.currentLocation, pageIndicatorOpacity, reduceMotion]);

  useEffect(() => () => {
    if (pageIndicatorTimerRef.current) clearTimeout(pageIndicatorTimerRef.current);
    cancelAnimation(pageIndicatorOpacity);
  }, [pageIndicatorOpacity]);

  useEffect(() => {
    if (bookId) markReaderOpen(bookId, 'READER_ROUTE_MOUNTED');
  }, [bookId]);

  useEffect(() => {
    pendingTocItemRef.current = null;
    pendingBookmarkRef.current = null;
    activeBookmarkSnapshotRequestRef.current = null;
    activePageLocationRequestRef.current = null;
    setToc([]);
    setBookmarks([]);
    setBookmarksLoaded(false);
    setBookmarkBusy(false);
    setCurrentBookmarked(false);
    setTocSheetPresented(false);
    setSettingsSheetPresented(false);
    setSearchSheetPresented(false);
    setTocNavigating(false);
    setTocNavigationRequest(null);
    setBookmarkSnapshotRequest(null);
    setBookmarkNavigationRequest(null);
    setPageLocationRequest(null);
    setPageByDestination({});
    setSearchNavigationRequest(null);
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
    setSearchResults([]);
    setRecentSearches([]);
    setSearching(false);
    setSearchComplete(false);
    setSearchError(null);
    setSearchInitialQueryRequest(null);
    activeSelectionRef.current = null;
    excerptActionPayloadRef.current = null;
    excerptActionPressingRef.current = false;
    excerptSavingRef.current = false;
    setActiveSelection(null);
    setExcerptSaving(false);
    setSelectionCommand(null);
    setExcerptVerificationRequest(null);
    setHighlightSnapshot(null);
  }, [bookId]);

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

  const readerInput = useMemo(() => controller.state.kind === 'opening'
    ? controller.state
    : controller.state.kind === 'ready'
      ? controller.state
      : null, [controller.state]);

  useEffect(() => {
    if (!__DEV__ || !bookId || controller.state.kind !== 'ready' || settingsSheetPresented) return undefined;
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
  }, [bookId, controller.state.kind, settingsSheetPresented]);

  const activePaginationCache = controller.pageCountCache
    && controller.currentLocation?.totalPages === controller.pageCountCache.totalPages
    ? controller.pageCountCache
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
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const closeReader = useCallback(() => {
    void Promise.all([
      controller.flushLocation().catch(() => undefined),
      controller.commitReaderSettings().catch(() => undefined),
    ]).finally(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    });
  }, [controller, router]);

  const unmountChromeAfterFade = useCallback(() => {
    if (!chromeVisibleRef.current) {
      chromeMountedRef.current = false;
      chromeLayoutsRef.current = { close: false, menu: false };
      chromeRevealStartedRef.current = false;
      chromeFadePendingRef.current = false;
      setGlassVisible(false);
      setChromeMounted(false);
    }
  }, []);

  const cancelChromeReadyFrame = useCallback(() => {
    if (chromeReadyFrameRef.current !== null) {
      cancelAnimationFrame(chromeReadyFrameRef.current);
      chromeReadyFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelChromeReadyFrame, [cancelChromeReadyFrame]);

  const beginChromeAfterLayout = useCallback(() => {
    if (!chromeVisibleRef.current || !chromeMountedRef.current || chromeRevealStartedRef.current) return;
    chromeRevealStartedRef.current = true;
    chromeFadePendingRef.current = true;
    setGlassVisible(true);
  }, []);

  useLayoutEffect(() => {
    if (!glassVisible || !chromeFadePendingRef.current || !chromeVisibleRef.current) return;
    chromeFadePendingRef.current = false;
    setChromeInteractive(true);
    const duration = reduceMotion ? 90 : 240;
    chromeProgress.set(withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
  }, [chromeProgress, glassVisible, reduceMotion]);

  const markChromeLayoutReady = useCallback((surface: 'close' | 'menu') => {
    chromeLayoutsRef.current[surface] = true;
    if (!chromeVisibleRef.current || chromeRevealStartedRef.current || chromeReadyFrameRef.current !== null) return;
    if (!chromeLayoutsRef.current.close || !chromeLayoutsRef.current.menu) return;
    chromeReadyFrameRef.current = requestAnimationFrame(() => {
      chromeReadyFrameRef.current = null;
      beginChromeAfterLayout();
    });
  }, [beginChromeAfterLayout]);

  const handleCloseLayout = useCallback(() => markChromeLayoutReady('close'), [markChromeLayoutReady]);
  const handleMenuLayout = useCallback(() => markChromeLayoutReady('menu'), [markChromeLayoutReady]);

  const setReaderChromeVisible = useCallback((visible: boolean) => {
    chromeVisibleRef.current = visible;
    setChromeVisible(visible);
    const duration = reduceMotion ? (visible ? 90 : 80) : (visible ? 240 : 160);
    setGlassAnimationDuration(duration / 1000);
    if (visible) {
      if (!chromeMountedRef.current) {
        chromeMountedRef.current = true;
        chromeLayoutsRef.current = { close: false, menu: false };
        chromeRevealStartedRef.current = false;
        setChromeInteractive(false);
        setGlassVisible(false);
        setChromeMounted(true);
        return;
      }
      cancelChromeReadyFrame();
      chromeRevealStartedRef.current = true;
      chromeFadePendingRef.current = false;
      setGlassVisible(true);
      setChromeInteractive(true);
      chromeProgress.set(withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
      return;
    }
    cancelChromeReadyFrame();
    chromeFadePendingRef.current = false;
    setChromeInteractive(false);
    setGlassVisible(false);
    chromeProgress.set(withTiming(0, { duration, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(unmountChromeAfterFade)();
    }));
  }, [cancelChromeReadyFrame, chromeProgress, reduceMotion, unmountChromeAfterFade]);

  // Keep the ref used by handleFootnoteOpen (declared above) pointing at the
  // latest setter; footnote taps must keep the reader in immersive mode.
  useEffect(() => {
    setReaderChromeVisibleRef.current = setReaderChromeVisible;
  }, [setReaderChromeVisible]);

  const toggleChrome = useCallback(async () => {
    // Center tap / chrome toggle is reader activity (also covers the DOM
    // onChromeRequest path).
    markReaderActivity();
    setReaderChromeVisible(!chromeVisibleRef.current);
  }, [markReaderActivity, setReaderChromeVisible]);

  const bookmarkAnchors = useMemo(() => bookmarks
    .filter((bookmark) => bookmark.spineIndex === controller.currentLocation?.spineIndex)
    .map((bookmark) => ({
      id: bookmark.id,
      cfi: bookmark.cfi,
      spineIndex: bookmark.spineIndex,
    })), [bookmarks, controller.currentLocation?.spineIndex]);

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
    if (!bookmarksLoaded || !controller.currentLocation || bookmarkBusy) return;
    requestBookmarkSnapshot('status');
  }, [bookmarkBusy, bookmarksLoaded, controller.currentLocation?.cfi, controller.pageCountCache?.layoutSignature, requestBookmarkSnapshot]);

  const toggleCurrentBookmark = useCallback(() => {
    if (!bookId || !controller.currentLocation || bookmarkBusy) return;
    markReaderActivity();
    setBookmarkBusy(true);
    requestBookmarkSnapshot('toggle');
  }, [bookId, bookmarkBusy, controller.currentLocation, markReaderActivity, requestBookmarkSnapshot]);

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

  const openToc = useCallback(() => {
    markReaderActivity();
    pendingTocItemRef.current = null;
    pendingBookmarkRef.current = null;
    setTocNavigating(false);
    setSettingsSheetPresented(false);
    setSearchSheetPresented(false);
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
    setTocSheetPresented(true);
  }, [markReaderActivity]);

  const openSettings = useCallback(() => {
    markReaderActivity();
    setTocSheetPresented(false);
    setSearchSheetPresented(false);
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
    setSettingsSheetPresented(true);
  }, [markReaderActivity]);

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
  }, [bookId]);

  const cancelSearch = useCallback(() => {
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
    setSearchResults([]);
    setSearching(false);
    setSearchComplete(false);
    setSearchError(null);
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
  }, [bookId]);

  const requestSearchSheetDismiss = useCallback(() => {
    activeSearchRequestRef.current = null;
    setSearchRequest(null);
    setSearchSheetPresented(false);
  }, []);

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

  const handleSettingsSheetDismissed = useCallback(() => {
    void controller.commitReaderSettings().catch(() => undefined);
  }, [controller.commitReaderSettings]);

  const requestSettingsSheetDismiss = useCallback(() => {
    // Flush the final slider value while the DOM still owns the session's
    // original CFI anchor. The following render then queues that setting
    // before ending the settings session.
    void controller.commitReaderSettings().catch(() => undefined);
    setSettingsSheetPresented(false);
  }, [controller.commitReaderSettings]);

  const resetReaderSettings = useCallback(() => {
    controller.updateReaderSettings(DEFAULT_READER_SETTINGS);
    void controller.commitReaderSettings().catch(() => undefined);
  }, [controller.commitReaderSettings, controller.updateReaderSettings]);

  const selectTocItem = useCallback((item: ReaderTocItem) => {
    if (tocNavigating) return;
    pendingBookmarkRef.current = null;
    pendingTocItemRef.current = item;
    setTocNavigating(true);
    setTocSheetPresented(false);
  }, [tocNavigating]);

  const selectBookmark = useCallback((bookmark: ReaderBookmark) => {
    if (tocNavigating) return;
    pendingTocItemRef.current = null;
    pendingBookmarkRef.current = bookmark;
    setTocNavigating(true);
    setTocSheetPresented(false);
  }, [tocNavigating]);

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
    setSearchInitialQueryRequest({ id: ++searchInitialQuerySequenceRef.current, query });
    clearReaderSelection();
  }, [clearReaderSelection, openSearch]);

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
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      highlightSavingRef.current = false;
    }
  }, [markReaderActivity]);

  // Fired by the adapter after it already removed the paint for a tapped
  // highlight. Only the SQLite row and the RN-side snapshot remain.
  const handleHighlightDeleteRequest = useCallback((rangeCfi: string) => {
    if (!bookId) return;
    setHighlightSnapshot((prev) => prev?.filter((item) => item.rangeCfi !== rangeCfi) ?? prev);
    void highlightRepository.deleteHighlightByRange(bookId, rangeCfi).catch((error: unknown) => {
      if (__DEV__) console.error('[HIGHLIGHT_DELETE_FAILED]', error);
    });
  }, [bookId]);

  const onNoteRequested = useCallback((payload: ReaderSelectionPayload) => {
    if (__DEV__) console.log('[ANNOTATION_ACTION]', JSON.stringify({ action: 'note', rangeCfi: payload.rangeCfi, textLength: payload.text.length }));
  }, []);

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

  const footnotePopoverLayout = useMemo(() => {
    if (!footnotePopover) return null;
    const width = Math.round(readerViewportWidth * FOOTNOTE_POPOVER_WIDTH_RATIO);
    const cappedMaxHeight = Math.round(readerViewportHeight * FOOTNOTE_POPOVER_MAX_HEIGHT_RATIO);
    const anchor = footnotePopover.anchorRect;
    const anchorCenterX = anchor.x + anchor.width / 2;
    const left = Math.min(
      readerViewportWidth - width - FOOTNOTE_POPOVER_EDGE_GAP,
      Math.max(FOOTNOTE_POPOVER_EDGE_GAP, anchorCenterX - width / 2),
    );
    const spaceAbove = anchor.y - insets.top - FOOTNOTE_POPOVER_ANCHOR_GAP;
    const spaceBelow = readerViewportHeight - insets.bottom - (anchor.y + anchor.height) - FOOTNOTE_POPOVER_ANCHOR_GAP;
    // Prefer above the anchor; fall back below when space is tight. Anchoring
    // by the bottom edge lets short popovers shrink toward the anchor without
    // measuring content height.
    const placeAbove = spaceAbove >= FOOTNOTE_POPOVER_MIN_HEIGHT || spaceAbove >= spaceBelow;
    if (placeAbove) {
      return {
        left,
        width,
        bottom: readerViewportHeight - anchor.y + FOOTNOTE_POPOVER_ANCHOR_GAP,
        maxHeight: Math.max(FOOTNOTE_POPOVER_MIN_HEIGHT, Math.min(cappedMaxHeight, spaceAbove)),
      };
    }
    return {
      left,
      width,
      top: anchor.y + anchor.height + FOOTNOTE_POPOVER_ANCHOR_GAP,
      maxHeight: Math.max(FOOTNOTE_POPOVER_MIN_HEIGHT, Math.min(cappedMaxHeight, spaceBelow)),
    };
  }, [footnotePopover, insets.bottom, insets.top, readerViewportHeight, readerViewportWidth]);

  const chromeContentStyle = useAnimatedStyle(() => ({ opacity: chromeProgress.get() }));
  const totalPageStyle = useAnimatedStyle(() => ({ opacity: chromeProgress.get() }));
  const pageIndicatorStyle = useAnimatedStyle(() => ({ opacity: pageIndicatorOpacity.get() }));

  return (
    <View
      ref={readerRootRef}
      style={[styles.screen, { backgroundColor: readerColors.background }]}
    >
      <StatusBar animated hidden={!chromeVisible} style={readerAppearance === 'dark' ? 'light' : 'dark'} />
      {/* iOS native-stack interactive-pop is a separate left-edge gesture from
          the DOM reader's page swipe. Disable it only for this route so a
          reader swipe can never unexpectedly dismiss the book to Library. */}
      <Stack.Screen options={{ headerShown: false, animation: readerOpeningVisible ? 'none' : 'fade', gestureEnabled: false }} />

      {controller.state.kind === 'opening' || controller.state.kind === 'ready' ? (
        <FoliateReaderDom
          source={controller.state.kind === 'opening' ? controller.state.source : null}
          restoreCfi={controller.state.restoreCfi}
          pageCountCache={controller.pageCountCache}
          readerSettings={controller.appliedReaderSettings}
          settingsSessionActive={settingsSheetPresented}
          tocNavigationRequest={tocNavigationRequest}
          bookmarkSnapshotRequest={bookmarkSnapshotRequest}
          bookmarkNavigationRequest={bookmarkNavigationRequest}
          pageLocationRequest={pageLocationRequest}
          searchRequest={searchRequest}
          searchNavigationRequest={searchNavigationRequest}
          selectionCommand={selectionCommand}
          excerptVerificationRequest={excerptVerificationRequest}
          highlightSnapshot={highlightSnapshot}
          textMeasureRequest={textMeasureRequest}
          onTextMeasureResult={handleTextMeasureResult}
          onHighlightDeleteRequest={handleHighlightDeleteRequest}
          onReady={controller.onEngineReady}
          onLocation={handleLocation}
          onDiagnostic={controller.onDiagnostic}
          onChromeRequest={toggleChrome}
          onError={controller.onEngineError}
          onResourceRequest={controller.onResourceRequest}
          onPageCount={controller.onPageCount}
          onToc={handleToc}
          onTocNavigationResult={handleTocNavigationResult}
          onBookmarkSnapshot={handleBookmarkSnapshot}
          onBookmarkNavigationResult={handleBookmarkNavigationResult}
          onPageLocationUpdate={handlePageLocationUpdate}
          onSearchUpdate={handleSearchUpdate}
          onSearchNavigationResult={handleSearchNavigationResult}
          onSelectionChange={handleSelectionChange}
          onFootnoteOpen={handleFootnoteOpen}
          footnoteModalOpen={footnoteModalOpen}
          dom={{
            scrollEnabled: false,
            style: [styles.domReader, { backgroundColor: readerColors.background }],
            ...(isReaderEditMenuNativeAvailable ? {
              readerEditMenuEnabled: true,
              onReaderSelectionAction: handleNativeSelectionAction,
            } : {}),
          }}
        />
      ) : null}

      {controller.state.kind === 'loading' ? (
        <View style={[styles.centerState, { backgroundColor: openingBackground }]} />
      ) : null}

      {/* Keep the same opaque Reader surface up until foliate has rendered its
          first page. Previously the loading state disappeared as soon as the
          DOM host mounted, leaving one visibly blank frame before the hidden
          paginator became visible. */}
      {controller.state.kind === 'opening' ? (
        <View pointerEvents="none" style={[styles.readerOpeningOverlay, { backgroundColor: openingBackground }]} />
      ) : null}

      {controller.state.kind === 'error' ? (
        <View style={[styles.centerState, { backgroundColor: readerColors.background }]}>
          <Text style={[styles.errorTitle, { color: readerColors.primary }]}>{uiText.reader.cannotOpen}</Text>
          <Text style={[styles.errorMessage, { color: readerColors.secondary }]}>{controller.state.message}</Text>
          <Pressable accessibilityRole="button" onPress={closeReader} style={styles.returnButton}>
            <Text style={[styles.returnButtonText, { color: readerColors.primary }]}>{uiText.reader.returnToLibrary}</Text>
          </Pressable>
        </View>
      ) : null}

      {readerInput ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View
            pointerEvents="none"
            style={[
              styles.bookTitleContainer,
              {
                left: `${READER_SETTINGS_LIMITS.pageMargin.min}%`,
                top: insets.top + READER_HEADER_SAFE_TOP_GAP + (HEADER_ACTION_SIZE - BOOK_TITLE_LINE_HEIGHT) / 2,
              },
            ]}
          >
            <Text numberOfLines={1} style={[styles.bookTitle, { color: readerColors.secondary }]}>{readerInput.book.title}</Text>
          </View>
          <View pointerEvents="none" style={{ bottom: Math.max(insets.bottom + 10, 10), left: tokens.spacing.screen, position: 'absolute' }}>
            <Animated.View style={pageIndicatorStyle}>
              <ReaderPageIndicator color={readerColors.secondary} location={displayedPageLocation} totalOpacityStyle={totalPageStyle} />
            </Animated.View>
          </View>
          {chromeMounted ? (
            <>
              <View style={[styles.closeButtonContainer, { top: insets.top + READER_HEADER_SAFE_TOP_GAP }]}>
                <ReaderGlassButton
                  accessibilityLabel={uiText.reader.close}
                  animationDuration={glassAnimationDuration}
                  contentOpacityStyle={chromeContentStyle}
                  colorScheme={readerAppearance}
                  fallbackColor={readerColors.glassFallback}
                  glassVisible={glassVisible}
                  icon="xmark"
                  interactive={chromeInteractive}
                  onLayout={handleCloseLayout}
                  onPress={closeReader}
                  tintColor={readerColors.primary}
                />
              </View>
              <View style={[styles.readerMenuContainer, { bottom: Math.max(insets.bottom - 6, 10) }]}>
                <ReaderControlBar
                  animationDuration={glassAnimationDuration}
                  bookmarkBusy={bookmarkBusy}
                  contentOpacityStyle={chromeContentStyle}
                  colorScheme={readerAppearance}
                  fallbackColor={readerColors.glassFallback}
                  glassVisible={glassVisible}
                  interactive={chromeInteractive}
                  currentBookmarked={currentBookmarked}
                  onLayout={handleMenuLayout}
                  onBookmarkPress={toggleCurrentBookmark}
                  onSearchPress={openSearch}
                  onSettingsPress={openSettings}
                  onTocPress={openToc}
                  tintColor={readerColors.primary}
                />
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {!isReaderEditMenuNativeAvailable && activeSelection && excerptActionPosition && !tocSheetPresented && !settingsSheetPresented && !searchSheetPresented ? (
        <ReaderExcerptAction
          colorScheme={readerAppearance}
          disabled={excerptSaving}
          fallbackColor={readerColors.glassFallback}
          left={excerptActionPosition.left}
          onPress={() => { void createExcerptFromSelection(); }}
          onPressIn={freezeExcerptSelection}
          onPressOut={releaseExcerptActionPress}
          textColor={readerColors.primary}
          top={excerptActionPosition.top}
        />
      ) : null}

      {readerInput ? (
        <ReaderTocSheet
          bookmarks={bookmarks}
          bookTitle={readerInput.book.title}
          currentLocation={controller.currentLocation}
          isNavigating={tocNavigating}
          isPresented={tocSheetPresented}
          onDismissed={handleTocSheetDismissed}
          onRequestDismiss={() => setTocSheetPresented(false)}
          onSelect={selectTocItem}
          onSelectBookmark={selectBookmark}
          pageByDestination={pageByDestination}
          toc={toc}
        />
      ) : null}

      {readerInput ? (
        <ReaderSettingsSheet
          isPresented={settingsSheetPresented}
          onChange={controller.updateReaderSettings}
          onDismissed={handleSettingsSheetDismissed}
          onRequestDismiss={requestSettingsSheetDismiss}
          onReset={resetReaderSettings}
          settings={controller.readerSettings}
        />
      ) : null}

      {readerInput ? (
        <ReaderSearchSheet
          appearance={readerAppearance}
          errorMessage={searchError}
          isPresented={searchSheetPresented}
          isSearching={searching}
          initialQueryRequest={searchInitialQueryRequest}
          onCancelSearch={cancelSearch}
          onClearRecent={clearRecentSearches}
          onCommitSearch={commitSearch}
          onDismissed={handleSearchSheetDismissed}
          onRequestDismiss={requestSearchSheetDismiss}
          onSearch={requestSearch}
          onSelectResult={selectSearchResult}
          recentSearches={recentSearches}
          results={displayedSearchResults}
          searchComplete={searchComplete}
        />
      ) : null}

      {footnotePopover && footnotePopoverLayout ? (
        <FootnotePopover
          colorScheme={readerAppearance}
          fallbackColor={readerColors.glassFallback}
          layout={footnotePopoverLayout}
          linkColor={readerColors.link}
          onDismiss={dismissFootnotePopover}
          payload={footnotePopover}
          textColor={readerColors.primary}
        />
      ) : null}

      {readerOpeningVisible && openingTitle ? (
        <Animated.View pointerEvents="auto" style={[styles.readerLaunchTransition, { backgroundColor: openingBackground }, readerOpeningStyle]}>
          <View style={[styles.readerLaunchCover, { backgroundColor: tokens.coverTones[openingCoverTone], height: readerLaunchCoverWidth / tokens.cover.gridAspectRatio, width: readerLaunchCoverWidth }]}>
            <BookCoverArt
              author={openingAuthor}
              coverTone={openingCoverTone}
              coverUri={openingCoverUri}
              hasGeneratedCover={openingGenerated}
              title={openingTitle}
            />
          </View>
        </Animated.View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.colors.background },
  domReader: { flex: 1, backgroundColor: tokens.colors.background },
  centerState: { alignItems: 'center', backgroundColor: tokens.colors.background, flex: 1, gap: 12, justifyContent: 'center', paddingHorizontal: 32 },
  readerOpeningOverlay: { alignItems: 'center', backgroundColor: tokens.colors.background, bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  readerLaunchTransition: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 100 },
  readerLaunchCover: {
    borderCurve: 'continuous',
    borderRadius: tokens.radius.cover,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  errorTitle: { color: '#1c1c1e', fontSize: 20, fontWeight: '700' },
  errorMessage: { color: '#767680', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  returnButton: { alignItems: 'center', borderRadius: 20, justifyContent: 'center', minHeight: 40, paddingHorizontal: 18 },
  returnButtonText: { color: '#1c1c1e', fontSize: 16, fontWeight: '600' },
  bookTitleContainer: { alignItems: 'flex-start', position: 'absolute', right: 76 },
  bookTitle: { color: '#8b8b90', fontSize: 15, fontWeight: '600', letterSpacing: -0.1, lineHeight: BOOK_TITLE_LINE_HEIGHT, textAlign: 'left' },
  closeButtonContainer: { height: HEADER_ACTION_SIZE, position: 'absolute', right: tokens.spacing.medium, width: HEADER_ACTION_SIZE },
  readerMenuContainer: { height: CONTROL_BAR_HEIGHT, position: 'absolute', right: tokens.spacing.medium, width: CONTROL_BAR_WIDTH },
  glassButton: { borderRadius: 22, height: 44, width: 44 },
  glassButtonFallback: { backgroundColor: 'rgba(250,250,252,0.86)', borderColor: 'rgba(60,60,67,0.15)', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, height: 44, shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, width: 44 },
  glassButtonContent: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  readerControlBar: { borderRadius: 26, height: CONTROL_BAR_HEIGHT, width: CONTROL_BAR_WIDTH },
  readerControlBarFallback: { backgroundColor: 'rgba(250,250,252,0.88)', borderColor: 'rgba(60,60,67,0.15)', borderRadius: 26, borderWidth: StyleSheet.hairlineWidth, height: CONTROL_BAR_HEIGHT, shadowColor: '#000000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.1, shadowRadius: 12, width: CONTROL_BAR_WIDTH },
  readerControlBarContent: { alignItems: 'center', flex: 1, flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 6 },
  readerControlButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 50 },
  excerptActionPosition: { height: EXCERPT_ACTION_HEIGHT, position: 'absolute', width: EXCERPT_ACTION_WIDTH, zIndex: 80 },
  excerptActionGlass: { borderRadius: EXCERPT_ACTION_HEIGHT / 2, height: EXCERPT_ACTION_HEIGHT, width: EXCERPT_ACTION_WIDTH },
  excerptActionFallback: {
    borderColor: 'rgba(60,60,67,0.15)',
    borderRadius: EXCERPT_ACTION_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    height: EXCERPT_ACTION_HEIGHT,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    width: EXCERPT_ACTION_WIDTH,
  },
  excerptActionContent: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  excerptActionText: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  footnotePopoverPosition: { position: 'absolute', zIndex: 90 },
  footnotePopoverGlass: { borderRadius: 18, overflow: 'hidden' },
  footnotePopoverFallback: {
    borderColor: 'rgba(60,60,67,0.15)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  footnotePopoverScrollContent: { paddingHorizontal: 14, paddingVertical: 12 },
  footnotePopoverText: { fontSize: FOOTNOTE_POPOVER_FONT_SIZE, lineHeight: Math.round(FOOTNOTE_POPOVER_FONT_SIZE * 1.45), textAlign: 'left' },
  positionContainer: { alignItems: 'center', flexDirection: 'row' },
  positionText: { color: '#8e8e93', fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '600' },
});