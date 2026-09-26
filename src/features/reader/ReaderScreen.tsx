import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Linking, Pressable, ScrollView, StyleSheet, Text, TextStyle, useWindowDimensions, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { AnimatedStyle, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { isReaderEditMenuNativeAvailable } from '../../../modules/reader-edit-menu';
import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import { BookCoverArt } from '../library/BookCoverArt';
import type { CoverTone } from '../library/library-types';
import type {
  FootnotePayload,
  FootnoteRichTextNode,
  ReaderLocation,
  ReaderRestoreState,
  ReaderTextMeasureRequest,
  ReaderTextMeasureResult,
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
import { useFootnotePopover } from './hooks/useFootnotePopover';
import { ReaderNotePopover } from './ReaderNotePopover';
import { useReaderBookmarks } from './hooks/useReaderBookmarks';
import { useReaderChrome } from './hooks/useReaderChrome';
import { useReaderNavigation } from './hooks/useReaderNavigation';
import { useReaderSearch } from './hooks/useReaderSearch';
import { EXCERPT_ACTION_EDGE_GAP, EXCERPT_ACTION_HEIGHT, EXCERPT_ACTION_WIDTH, useReaderSelection } from './hooks/useReaderSelection';
import { useReaderSheets } from './hooks/useReaderSheets';
import { useReaderToc } from './hooks/useReaderToc';

const CONTROL_BAR_WIDTH = 232;
const CONTROL_BAR_HEIGHT = 52;
const HEADER_ACTION_SIZE = 44;
const BOOK_TITLE_LINE_HEIGHT = 20;
const READER_HEADER_SAFE_TOP_GAP = 2;
const READER_OPENING_COVER_FADE_MS = 300;
const FOOTNOTE_POPOVER_FONT_SIZE = 14;

const readerOpeningCoverTones = new Set<CoverTone>(['paper', 'coral', 'mist', 'ink', 'sage', 'plum', 'ocean']);

function firstRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// ReaderScreen 巨型组件拆分：collectTocPageTargets 已移至 useReaderNavigation。

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
      <SymbolView name={icon} size={26} tintColor={tintColor} weight="semibold" />
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
  const [reduceMotion, setReduceMotion] = useState(false);
  const {
    tocSheetPresented,
    setTocSheetPresented,
    settingsSheetPresented,
    setSettingsSheetPresented,
    searchSheetPresented,
    setSearchSheetPresented,
  } = useReaderSheets({ bookId });

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

  const {
    chromeMounted,
    chromeVisible,
    chromeInteractive,
    glassVisible,
    glassAnimationDuration,
    chromeProgress,
    chromeVisibleRef,
    setReaderChromeVisible,
    toggleChrome,
    handleCloseLayout,
    handleMenuLayout,
  } = useReaderChrome({ reduceMotion, markReaderActivity });

  const {
    footnotePopover,
    footnoteModalOpen,
    readerRootRef,
    handleFootnoteOpen,
    dismissFootnotePopover,
    footnotePopoverLayout,
  } = useFootnotePopover({
    markReaderActivity,
    readerAppearance,
    bookId,
    chromeVisibleRef,
    setReaderChromeVisible,
    tocSheetPresented,
    settingsSheetPresented,
    searchSheetPresented,
    viewportWidth: readerViewportWidth,
    viewportHeight: readerViewportHeight,
    insetTop: insets.top,
    insetBottom: insets.bottom,
  });
  const {
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
  } = useReaderSearch({
    bookId,
    markReaderActivity,
    setTocSheetPresented,
    setSettingsSheetPresented,
    setSearchSheetPresented,
  });
  const {
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
  } = useReaderToc({
    bookId,
    markReaderActivity,
    setTocSheetPresented,
    setSettingsSheetPresented,
    setSearchSheetPresented,
    cancelSearchRequest,
  });
  const {
    bookmarks,
    bookmarksLoaded,
    bookmarkBusy,
    currentBookmarked,
    bookmarkSnapshotRequest,
    toggleCurrentBookmark,
    handleBookmarkSnapshot,
  } = useReaderBookmarks({
    bookId,
    markReaderActivity,
    currentLocation: controller.currentLocation,
    layoutSignature: controller.pageCountCache?.layoutSignature,
  });
  const {
    activeSelection,
    excerptSaving,
    selectionCommand,
    excerptVerificationRequest,
    highlightSnapshot,
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
    notePopover,
    notePopoverOpen,
    handleNativeSelectionAction,
    freezeExcerptSelection,
    releaseExcerptActionPress,
    createExcerptFromSelection,
    excerptActionPosition,
  } = useReaderSelection({
    bookId,
    markReaderActivity,
    openSearch,
    requestInitialSearchQuery,
    readerViewportWidth,
    readerViewportHeight,
    insets,
    isReady: controller.state.kind === 'ready',
    settingsSheetPresented,
  });
  const [readerOpeningVisible, setReaderOpeningVisible] = useState(Boolean(openingTitle));
  const pageIndicatorOpacity = useSharedValue(0);
  const {
    pageLocationRequest,
    pageByDestination,
    excerptNavigationRequest,
    externalNavMessage,
    displayedPageLocation,
    displayedSearchResults,
    handlePageLocationUpdate,
    showExternalNavMessage,
    handleExcerptNavigationResult,
  } = useReaderNavigation({
    bookId,
    toc,
    bookmarks,
    searchComplete,
    searchResults,
    currentLocation: controller.currentLocation,
    pageCountCache: controller.pageCountCache,
    externalTargetFailed: controller.externalTargetFailed,
    isReady: controller.state.kind === 'ready',
    reduceMotion,
    pageIndicatorOpacity,
    isFocused,
  });
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
    if (bookId) markReaderOpen(bookId, 'READER_ROUTE_MOUNTED');
  }, [bookId]);

  const readerInput = useMemo(() => controller.state.kind === 'opening'
    ? controller.state
    : controller.state.kind === 'ready'
      ? controller.state
      : null, [controller.state]);

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

  const openSettings = useCallback(() => {
    markReaderActivity();
    setTocSheetPresented(false);
    setSearchSheetPresented(false);
    cancelSearchRequest();
    setSettingsSheetPresented(true);
  }, [markReaderActivity, cancelSearchRequest]);



  // Excerpts Tab Core C: self-dismissing transient notice. There is no
  // app-wide toast system, so this stays local to the Reader screen.

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
          externalTargetCfi={controller.state.externalTargetCfi}
          excerptNavigationRequest={excerptNavigationRequest}
          onExcerptNavigationResult={handleExcerptNavigationResult}
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
          onHighlightNoteTap={handleHighlightNoteTap}
          notePopoverOpen={notePopoverOpen}
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

      {/* Excerpts Tab Core C: lightweight transient notice for external
          navigation failures. Local to the Reader screen; no app-wide toast
          system is introduced for this. */}
      {externalNavMessage ? (
        <View pointerEvents="none" style={styles.externalNavMessageWrap}>
          <View style={[styles.externalNavMessagePill, { backgroundColor: readerColors.primary }]}>
            <Text style={[styles.externalNavMessageText, { color: readerColors.background }]}>{externalNavMessage}</Text>
          </View>
        </View>
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

      {notePopover ? (
        <ReaderNotePopover
          state={notePopover}
          viewportWidth={readerViewportWidth}
          viewportHeight={readerViewportHeight}
          insetTop={insets.top}
          insetBottom={insets.bottom}
          colorScheme={readerAppearance}
          textColor={readerColors.primary}
          secondaryColor={readerColors.secondary}
          placeholderColor={readerColors.secondary}
          destructiveColor="#ff3b30"
          accentColor={readerColors.link}
          fallbackColor={readerColors.glassFallback}
          onDismiss={closeNotePopover}
          onSave={saveNote}
          onEdit={startEditNote}
          onDelete={deleteNoteHighlight}
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
  // Excerpts Tab Core C: transient failure notice. Inverted pill (primary on
  // background) so it reads in both appearances; pointer-events are disabled
  // at the render site so it never blocks reader gestures.
  externalNavMessageWrap: {
    alignItems: 'center',
    bottom: 120,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 30,
  },
  externalNavMessagePill: { borderRadius: 20, opacity: 0.92, paddingHorizontal: 16, paddingVertical: 10 },
  externalNavMessageText: { fontSize: 14, fontWeight: '600' },
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