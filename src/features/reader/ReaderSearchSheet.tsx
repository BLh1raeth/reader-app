import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  frame,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  type KeyboardEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import type { BookSearchHistoryItem } from './book-search-history-repository';
import type { ReaderSearchInitialQueryRequest, ReaderSearchResult } from './reader-types';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_FLOATING_HEADER_HEIGHT = 94;

type Props = {
  appearance: 'light' | 'dark';
  errorMessage: string | null;
  isPresented: boolean;
  isSearching: boolean;
  initialQueryRequest: ReaderSearchInitialQueryRequest | null;
  onCancelSearch: () => void;
  onClearRecent: () => void;
  onCommitSearch: (query: string) => void;
  onDismissed: () => void;
  onRequestDismiss: () => void;
  onSearch: (query: string) => void;
  onSelectResult: (result: ReaderSearchResult, query: string) => void;
  recentSearches: BookSearchHistoryItem[];
  results: ReaderSearchResult[];
  searchComplete: boolean;
};

type SearchListItem =
  | { kind: 'recent'; key: string; query: string }
  | { kind: 'result'; key: string; result: ReaderSearchResult };

function SearchSurface({
  appearance,
  children,
  circular = false,
  style,
}: {
  appearance: 'light' | 'dark';
  children: React.ReactNode;
  circular?: boolean;
  style: object;
}) {
  if (isGlassEffectAPIAvailable()) {
    return (
      <GlassView
        colorScheme={appearance}
        glassEffectStyle="regular"
        isInteractive
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        style,
        circular ? styles.circularFallback : styles.searchFallback,
        { backgroundColor: appearance === 'dark' ? 'rgba(44,44,46,0.92)' : 'rgba(250,250,252,0.92)' },
      ]}
    >
      {children}
    </View>
  );
}

export function ReaderSearchSheet({
  appearance,
  errorMessage,
  isPresented,
  isSearching,
  initialQueryRequest,
  onCancelSearch,
  onClearRecent,
  onCommitSearch,
  onDismissed,
  onRequestDismiss,
  onSearch,
  onSelectResult,
  recentSearches,
  results,
  searchComplete,
}: Props) {
  const insets = useSafeAreaInsets();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const immediateQueryRef = useRef<string | null>(null);
  const lastInitialQueryRequestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [showSearching, setShowSearching] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const normalizedQuery = query.trim();
  const primaryColor = appearance === 'dark' ? '#f2f2f7' : '#171719';
  const secondaryColor = appearance === 'dark' ? '#aeaeb2' : '#8e8e93';
  const separatorColor = appearance === 'dark' ? 'rgba(235,235,245,0.16)' : 'rgba(60,60,67,0.12)';
  const listData: SearchListItem[] = normalizedQuery
    ? results.map((result) => ({ kind: 'result', key: result.id, result }))
    : recentSearches.map((item) => ({ kind: 'recent', key: item.query.toLocaleLowerCase(), query: item.query }));

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearDebounce();
    if (!isPresented) return;
    if (immediateQueryRef.current === normalizedQuery) {
      immediateQueryRef.current = null;
      return;
    }
    // Invalidate the previous request as soon as the text changes. The next
    // request is intentionally delayed, but stale results must not remain in
    // the list or win the bridge race during that 300 ms window.
    onCancelSearch();
    if (!normalizedQuery) return;
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      onSearch(normalizedQuery);
    }, SEARCH_DEBOUNCE_MS);
    return clearDebounce;
  }, [clearDebounce, isPresented, normalizedQuery, onCancelSearch, onSearch]);

  useEffect(() => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
    if (!isSearching) {
      setShowSearching(false);
      return;
    }
    loadingTimerRef.current = setTimeout(() => {
      loadingTimerRef.current = null;
      setShowSearching(true);
    }, 120);
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [isSearching]);

  useEffect(() => {
    if (isPresented) return;
    clearDebounce();
    setQuery('');
    setShowSearching(false);
    setKeyboardVisible(false);
  }, [clearDebounce, isPresented]);

  useEffect(() => {
    const request = initialQueryRequest;
    if (!isPresented || !request || request.id === lastInitialQueryRequestRef.current) return;
    const nextQuery = request.query.trim();
    if (!nextQuery) return;
    lastInitialQueryRequestRef.current = request.id;
    immediateQueryRef.current = nextQuery;
    setQuery(nextQuery);
    clearDebounce();
    onCommitSearch(nextQuery);
  }, [clearDebounce, initialQueryRequest, isPresented, onCommitSearch]);

  useEffect(() => {
    const updateKeyboard = (visible: boolean) => (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardVisible(visible);
    };
    const showSubscription = Keyboard.addListener('keyboardWillShow', updateKeyboard(true));
    const hideSubscription = Keyboard.addListener('keyboardWillHide', updateKeyboard(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => () => {
    clearDebounce();
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
  }, [clearDebounce]);

  const submitQuery = useCallback((value: string) => {
    const submittedQuery = value.trim();
    if (!submittedQuery) return;
    clearDebounce();
    onCommitSearch(submittedQuery);
  }, [clearDebounce, onCommitSearch]);

  const renderItem = useCallback(({ item }: { item: SearchListItem }) => {
    if (item.kind === 'recent') {
      return (
        <Pressable
          accessibilityLabel={uiText.search.searchFor(item.query)}
          accessibilityRole="button"
          onPress={() => {
            immediateQueryRef.current = item.query.trim();
            setQuery(item.query);
            submitQuery(item.query);
          }}
          style={({ pressed }) => [styles.recentRow, { borderBottomColor: separatorColor }, pressed ? styles.rowPressed : null]}
        >
          <SymbolView name="magnifyingglass" size={17} tintColor={secondaryColor} weight="regular" />
          <Text numberOfLines={1} style={[styles.recentQuery, { color: primaryColor }]}>{item.query}</Text>
        </Pressable>
      );
    }
    const { result } = item;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => onSelectResult(result, normalizedQuery)}
        style={({ pressed }) => [styles.resultRow, { borderBottomColor: separatorColor }, pressed ? styles.rowPressed : null]}
      >
        {result.chapterTitle || result.pageNumber !== null ? (
          <View style={styles.resultMeta}>
            {result.chapterTitle ? (
              <Text numberOfLines={1} style={[styles.chapterTitle, { color: primaryColor }]}>{result.chapterTitle}</Text>
            ) : <View style={styles.resultMetaSpacer} />}
            {result.pageNumber !== null ? (
              <Text style={[styles.resultPage, { color: secondaryColor }]}>{result.pageNumber}</Text>
            ) : null}
          </View>
        ) : null}
        <Text numberOfLines={3} style={[styles.excerpt, { color: secondaryColor }]}>
          {result.excerpt.pre}
          <Text style={[styles.match, { color: primaryColor }]}>{result.excerpt.match}</Text>
          {result.excerpt.post}
        </Text>
      </Pressable>
    );
  }, [normalizedQuery, onSelectResult, primaryColor, secondaryColor, separatorColor, submitQuery]);

  const emptyContent = normalizedQuery
    ? errorMessage
      ? errorMessage
      : searchComplete && !isSearching
        ? uiText.search.noResults(normalizedQuery)
        : showSearching
          ? uiText.search.searching
          : ''
    : recentSearches.length
      ? ''
      : uiText.search.recentEmpty;

  return (
    <Host pointerEvents="none" style={styles.sheetHost}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismissed}
        onIsPresentedChange={(presented) => {
          if (!presented) onRequestDismiss();
        }}
      >
        <Group modifiers={[
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
          presentationDetents(['medium']),
          presentationDragIndicator('hidden'),
          presentationBackground('transparent'),
        ]}>
          <RNHostView>
            <View style={styles.sheetContent}>
              {isGlassEffectAPIAvailable() ? (
                <GlassView
                  colorScheme={appearance}
                  glassEffectStyle="clear"
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, { bottom: -insets.bottom }]}
                />
              ) : (
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: appearance === 'dark' ? 'rgba(28,28,30,0.88)' : 'rgba(246,246,250,0.84)', bottom: -insets.bottom },
                  ]}
                />
              )}

              <FlatList
                contentContainerStyle={listData.length
                  ? [styles.listContent, {
                    paddingBottom: 0,
                    paddingTop: SEARCH_FLOATING_HEADER_HEIGHT,
                  }]
                  : [styles.emptyListContent, {
                    paddingBottom: 0,
                    paddingTop: SEARCH_FLOATING_HEADER_HEIGHT,
                  }]}
                data={listData}
                initialNumToRender={10}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                keyExtractor={(item) => item.key}
                ListEmptyComponent={emptyContent ? (
                  <View style={styles.emptyState}>
                    {showSearching && normalizedQuery && !errorMessage ? <ActivityIndicator color={secondaryColor} size="small" /> : null}
                    <Text style={[styles.emptyText, { color: secondaryColor }]}>{emptyContent}</Text>
                  </View>
                ) : null}
                renderItem={renderItem}
                style={[
                  styles.list,
                  { marginBottom: keyboardVisible ? 0 : -insets.bottom },
                ]}
                windowSize={8}
              />

              <View pointerEvents="box-none" style={styles.floatingHeader}>
                <View pointerEvents="none" style={styles.titleRow}>
                  <Text style={[styles.title, { color: primaryColor }]}>{uiText.search.title}</Text>
                </View>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: primaryColor }]}>{normalizedQuery ? uiText.search.results : uiText.search.recent}</Text>
                  {!normalizedQuery && recentSearches.length ? (
                    <Pressable accessibilityRole="button" hitSlop={10} onPress={onClearRecent}>
                      <Text style={[styles.clearText, { color: primaryColor }]}>{uiText.search.clear}</Text>
                    </Pressable>
                  ) : showSearching ? (
                    <ActivityIndicator color={secondaryColor} size="small" />
                  ) : null}
                </View>
              </View>

              <View style={[styles.searchArea, { bottom: keyboardVisible ? 12 : -20 }]}>
                <SearchSurface appearance={appearance} style={styles.searchFieldSurface}>
                  <View style={styles.searchFieldContent}>
                    <SymbolView name="magnifyingglass" size={19} tintColor={secondaryColor} weight="semibold" />
                    <TextInput
                      accessibilityLabel={uiText.search.field}
                      autoCapitalize="none"
                      autoCorrect={false}
                      clearButtonMode="while-editing"
                      onChangeText={setQuery}
                      onSubmitEditing={() => submitQuery(query)}
                      placeholder={uiText.search.field}
                      placeholderTextColor={secondaryColor}
                      returnKeyType="search"
                      selectionColor={tokens.colors.blue}
                      style={[styles.searchInput, { color: primaryColor }]}
                      value={query}
                    />
                  </View>
                </SearchSurface>
                <SearchSurface appearance={appearance} circular style={styles.closeSurface}>
                  <Pressable
                    accessibilityLabel={uiText.search.close}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={onRequestDismiss}
                    style={styles.closeButton}
                  >
                    <SymbolView name="xmark" size={20} tintColor={primaryColor} weight="semibold" />
                  </Pressable>
                </SearchSurface>
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
  floatingHeader: { left: 0, position: 'absolute', right: 0, top: 8, zIndex: 3 },
  titleRow: { alignItems: 'center', height: 44, justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', lineHeight: 24, textAlign: 'center' },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', height: 50, justifyContent: 'space-between', paddingHorizontal: 24 },
  sectionTitle: { fontSize: 19, fontWeight: '700', lineHeight: 24 },
  clearText: { fontSize: 16, fontWeight: '600' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 20 },
  emptyListContent: { flexGrow: 1 },
  recentRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 54, paddingHorizontal: 6 },
  recentQuery: { flex: 1, fontSize: 16, fontWeight: '500' },
  resultRow: { borderBottomWidth: StyleSheet.hairlineWidth, gap: 5, minHeight: 82, paddingHorizontal: 6, paddingVertical: 11 },
  resultMeta: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  resultMetaSpacer: { flex: 1 },
  chapterTitle: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 18 },
  resultPage: { fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '500', lineHeight: 18, textAlign: 'right' },
  excerpt: { fontSize: 15, lineHeight: 20 },
  match: { fontWeight: '700' },
  rowPressed: { backgroundColor: 'rgba(60,60,67,0.08)', borderRadius: 12 },
  emptyState: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', paddingBottom: 28, paddingHorizontal: 24 },
  emptyText: { fontSize: 15, fontWeight: '500', lineHeight: 20, textAlign: 'center' },
  searchArea: { alignItems: 'center', flexDirection: 'row', gap: 10, left: 0, paddingHorizontal: 12, position: 'absolute', right: 0, zIndex: 4 },
  searchFieldSurface: { borderRadius: 24, flex: 1, height: 48, overflow: 'hidden' },
  searchFieldContent: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 9, paddingLeft: 16, paddingRight: 8 },
  searchInput: { flex: 1, fontSize: 17, height: 48, padding: 0 },
  closeSurface: { borderRadius: 24, height: 48, overflow: 'hidden', width: 48 },
  closeButton: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  searchFallback: { borderColor: 'rgba(60,60,67,0.16)', borderWidth: StyleSheet.hairlineWidth },
  circularFallback: { borderColor: 'rgba(60,60,67,0.16)', borderWidth: StyleSheet.hairlineWidth },
});
