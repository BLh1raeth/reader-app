import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import { bookRepository } from '../library/book-repository';
import { createReaderExternalNavigationRequest } from '../reader/reader-external-navigation';
import {
  groupExcerptFeedByBook,
  groupExcerptFeedItems,
  type ExcerptFeedSection,
} from './excerpt-feed-grouping';
import { useExcerptsView, type ExcerptsViewMode } from './excerpts-view-context';
import {
  listExcerptFeedItems,
  type ExcerptFeedItem,
} from './excerpt-feed-repository';

const GROUP_LABELS = {
  today: uiText.excerpts.today,
  yesterday: uiText.excerpts.yesterday,
  past7Days: uiText.excerpts.past7Days,
  thisMonth: uiText.excerpts.thisMonth,
  monthTitle: uiText.excerpts.monthTitle,
};

const CELL_RADIUS = 26;
const CONTENT_HORIZONTAL_PADDING = 20;
const ITEM_HORIZONTAL_PADDING = 16;
// 正文右 inset：收起态是"裸文本 + 容器硬裁"（无省略号），iOS 按像素裁剪；
// 窄 advance 的 CJK 标点（如"、"）字形墨水会超出 advance 被拦腰切断。
// 6pt 让断行提前，字形墨水不贴裁剪边（禁则规则会把标点带下行）。
// 下在容器上（quoteClip / quoteStaticWrap / quoteMeasure），不下在 Text 自身。
const QUOTE_RIGHT_INSET = 6;
// 展开动画：收起态正文固定 2 行 × lineHeight 22 = 44pt
//（与 styles.quote.lineHeight 耦合；改字号/行高时同步改这里）。
const COLLAPSED_QUOTE_HEIGHT = 44;
// 徐徐展开：400ms + easeInOut；不用 spring，回弹不符合"徐徐"。
const EXPAND_ANIMATION_DURATION = 400;

function sourceLine(item: ExcerptFeedItem): string {
  const book = `《${item.bookTitle}》`;
  return item.chapterTitle ? `${book} · ${item.chapterTitle}` : book;
}

/**
 * Excerpts Tab Core E：Books mode 的 Source 行。
 * section header 已经是书名，这里只显示章节名，不重复书名。
 * chapterTitle 为空时显示轻量"返回原文"：保住 Source 导航入口
 * （§14 审计：chapterTitle 可能为 null——来自 Reader 的 TOC snapshot，
 * 无目录的 EPUB 会缺失；time mode 本来就有 null 回退，说明真实数据里存在）。
 * 导航 payload（bookId + rangeCfi）不受显示文本影响。
 */
function bookModeSourceText(item: ExcerptFeedItem): string {
  return item.chapterTitle ? item.chapterTitle : uiText.excerpts.backToSource;
}

function bookModeSourceAccessibilityLabel(item: ExcerptFeedItem): string {
  return item.chapterTitle
    ? `${item.chapterTitle}，返回原文`
    : uiText.excerpts.backToSource;
}

function accessibilityLabelFor(item: ExcerptFeedItem): string {
  const parts = [item.quoteText];
  if (item.noteText) parts.push(item.noteText);
  parts.push(sourceLine(item));
  return parts.join('。');
}

/**
 * 可展开的正文：纯窗帘式高度动画。
 *
 * 每一行在展开前就已固定：正文永远渲染全文（无 numberOfLines、无"…"），
 * 收起态只是容器裁到 44 高。动画全程只有容器高度在变（400ms easeInOut，
 * UI 线程），文字本体零变化、零重排——已显示的行像素级不动，
 * 新行像窗帘一样一行一行露出来。刻意不加渐隐罩/省略号：
 * 任何覆盖在已显示行上的东西，出现和消失时都会"改变"它们。
 *
 * 关键：Text 高度冻结为全文自然高度（contentHeight）。iOS 排版时会以
 * 容器的当前高度为约束——不冻结的话，每次点击/动画帧都会触发重排，
 * 断行随容器高度漂移（2026-09-21 真机 + onTextLayout 日志实锤）。
 * 冻结后排版只由 (文本, 样式, 宽度) 决定，点击不再触发任何重排。
 */
function ExpandableQuote({
  item,
  isExpanded,
  fullHeight,
  onToggleExpand,
}: {
  item: ExcerptFeedItem;
  isExpanded: boolean;
  /** 隐藏测量 Text 量出的全文自然高度（动画目标值）；0 表示尚未量出 */
  fullHeight: number;
  onToggleExpand: (itemId: string) => void;
}) {
  const heightSV = useSharedValue(COLLAPSED_QUOTE_HEIGHT);
  const reduceMotionRef = useRef(false);
  // 正文高度冻结为全文自然高度（ceil 防亚像素裁剪）：Text 的排版只由
  // (文本, 样式, 宽度, 固定高度) 决定，与外层动画容器的高度彻底解耦。
  // 否则 iOS 会以容器当前高度为约束重排文本——onTextLayout 日志实锤：
  // 每次点击展开/收起都会触发 3→4→5→6（或反向）多次重排，断行随高度漂移。
  // 2026-09-21 真机复现，修完后点击应不再触发任何重排。
  const contentHeight = Math.ceil(fullHeight);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        reduceMotionRef.current = v;
      })
      .catch(() => {});
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    height: heightSV.value,
  }));

  useEffect(() => {
    const targetHeight = isExpanded
      ? Math.max(contentHeight, COLLAPSED_QUOTE_HEIGHT)
      : COLLAPSED_QUOTE_HEIGHT;
    if (reduceMotionRef.current) {
      heightSV.value = targetHeight;
    } else {
      // 只有高度在动：withTiming 被打断时从当前值平滑反转，无需收尾处理。
      heightSV.value = withTiming(targetHeight, {
        duration: EXPAND_ANIMATION_DURATION,
        easing: Easing.inOut(Easing.ease),
      });
    }
  }, [isExpanded, contentHeight, heightSV]);

  return (
    <Pressable
      onPress={() => onToggleExpand(item.id)}
      // 无 pressed 视觉反馈：opacity 跳变会与正文切换叠在同一帧，
      // 在真机上被感知为文字闪烁。保持视觉极简。
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
      accessibilityHint={isExpanded ? '轻点收起摘录' : '轻点展开完整摘录'}
      accessibilityLabel={item.quoteText}
    >
      <Animated.View style={[styles.quoteClip, animatedStyle]}>
        <Text style={[styles.quote, { height: contentHeight }]}>
          {item.quoteText}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function ExcerptFeedItemRow({
  item,
  viewMode,
  isFirst,
  isLast,
  isExpanded,
  isTruncated,
  fullHeight,
  onToggleExpand,
  onTruncationMeasured,
  onSourcePress,
}: {
  item: ExcerptFeedItem;
  /** Excerpts Tab Core E：books mode 下 Source 行只显示章节名（不重复书名）。 */
  viewMode: ExcerptsViewMode;
  isFirst: boolean;
  isLast: boolean;
  isExpanded: boolean;
  /**
   * 基于真实 Text layout 的截断判定：
   * true = 实际超过 2 行，可点击展开；false = 短摘录，完全不可交互；
   * undefined = 尚未完成不可见测量。
   */
  isTruncated: boolean | undefined;
  /** 隐藏测量 Text 量出的全文自然高度；0 表示尚未量出 */
  fullHeight: number;
  onToggleExpand: (itemId: string) => void;
  onTruncationMeasured: (
    itemId: string,
    text: string,
    truncated: boolean,
    fullHeight: number,
  ) => void;
  /** Excerpts Tab Core C: Source 行是唯一的原文入口。 */
  onSourcePress: (item: ExcerptFeedItem) => void;
}) {
  // 不可见测量的 layout 回调：无 numberOfLines 的隐藏 Text 给出完整行数，
  // 最后一行的底边即全文自然高度（与可见全文版同款式同宽度，动画目标值精确可信）。
  const handleMeasureLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      const lines = event.nativeEvent.lines;
      const lastLine = lines[lines.length - 1];
      const measuredFullHeight = lastLine ? lastLine.y + lastLine.height : 0;
      onTruncationMeasured(
        item.id,
        item.quoteText,
        lines.length > 2,
        measuredFullHeight,
      );
    },
    [item.id, item.quoteText, onTruncationMeasured],
  );

  const quote = (
    <Text
      style={styles.quote}
      numberOfLines={isExpanded ? undefined : 2}
      ellipsizeMode="tail"
    >
      {item.quoteText}
    </Text>
  );

  return (
    <View
      // 可展开时容器不再整体 accessible：让 quote 的 button 语义生效，
      // 避免 VoiceOver 把内外合并成一个元素吞掉展开状态。
      accessible={!isTruncated}
      accessibilityLabel={isTruncated ? undefined : accessibilityLabelFor(item)}
      style={[
        styles.item,
        isFirst && styles.itemFirst,
        isLast && styles.itemLast,
      ]}
    >
      {isTruncated ? (
        <ExpandableQuote
          item={item}
          isExpanded={isExpanded}
          fullHeight={fullHeight}
          onToggleExpand={onToggleExpand}
        />
      ) : (
        <View style={styles.quoteStaticWrap}>{quote}</View>
      )}
      {isTruncated === undefined ? (
        // 一次性不可见测量：同款式、同宽度、无行数限制，absolute 不占布局。
        // 测出结果后即卸载，不再重测（文本变化时自动失效重测）。
        <Text
          style={[styles.quote, styles.quoteMeasure]}
          onTextLayout={handleMeasureLayout}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          aria-hidden
        >
          {item.quoteText}
        </Text>
      ) : null}
      {item.noteText ? (
        <Text
          style={styles.note}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {item.noteText}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          viewMode === 'books'
            ? bookModeSourceAccessibilityLabel(item)
            : accessibilityLabelFor(item)
        }
        accessibilityHint="轻点返回原文位置"
        hitSlop={{ top: 8, bottom: 8 }}
        onPress={() => onSourcePress(item)}
        style={({ pressed }) => [styles.sourcePressable, pressed && styles.sourcePressed]}
      >
        <Text
          style={styles.source}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {viewMode === 'books' ? bookModeSourceText(item) : sourceLine(item)}
        </Text>
      </Pressable>
    </View>
  );
}

export default function ExcerptsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Excerpts Tab Core E：按时间 / 按书籍浏览模式（内存态，与书库 Grid/List 对齐）。
  const { viewMode } = useExcerptsView();
  // null = loading（与 empty 区分开，避免 empty → 列表一闪而过）
  // 全量 Feed read model：viewMode 切换时在内存里重分组，不再查 DB。
  const [feed, setFeed] = useState<ExcerptFeedItem[] | null>(null);
  const [sections, setSections] = useState<ExcerptFeedSection[] | null>(null);
  // 搜索 query：非空时在内存里过滤 feed，扁平展示，不按 viewMode 分组。
  const [query, setQuery] = useState('');
  // 全 Feed 唯一展开态：纯 UI ephemeral state，不写数据库
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  // itemId -> { 测量时的文本, 是否实际超过 2 行, 全文自然高度 }；
  // 文本变化自动失效重测
  const [truncInfo, setTruncInfo] = useState<
    Record<string, { text: string; truncated: boolean; fullHeight: number }>
  >({});

  const handleTruncationMeasured = useCallback(
    (itemId: string, text: string, truncated: boolean, fullHeight: number) => {
      setTruncInfo((prev) => {
        const cur = prev[itemId];
        if (cur && cur.text === text && cur.truncated === truncated) return prev;
        return { ...prev, [itemId]: { text, truncated, fullHeight } };
      });
    },
    [],
  );

  const toggleExpand = useCallback((itemId: string) => {
    // 同一时间只展开 1 条：点已展开的则收起，点另一条则切换
    setExpandedItemId((prev) => (prev === itemId ? null : itemId));
  }, []);

  const loadFeed = useCallback(async () => {
    try {
      const items = await listExcerptFeedItems();
      const ids = new Set(items.map((i) => i.id));
      // refresh 后展开项若已不存在（删书/删 annotation），清空悬空 id
      setExpandedItemId((prev) => (prev !== null && ids.has(prev) ? prev : null));
      setFeed(items);
    } catch (error) {
      if (__DEV__) console.error('[EXCERPT_FEED_LOAD_FAILED]', error);
      // 加载失败时保持旧数据，不闪成 empty state
    }
  }, []);

  // Excerpts Tab 搜索：按 viewMode 分组。time = 现有时间分组（逻辑不动）；
  // books = 按 bookId 分组。同一个 feed 做 presentation 层重组，不重查 DB。
  // query 非空时：在内存里过滤，扁平展示（不分组），两种 viewMode 下一致。
  useEffect(() => {
    if (feed === null) {
      setSections(null);
      return;
    }
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length > 0) {
      const filtered = feed.filter((item) =>
        item.quoteText.toLowerCase().includes(trimmed) ||
        (item.noteText?.toLowerCase().includes(trimmed) ?? false) ||
        item.bookTitle.toLowerCase().includes(trimmed) ||
        (item.chapterTitle?.toLowerCase().includes(trimmed) ?? false),
      );
      setSections(filtered.length > 0 ? [{ key: 'search', title: '', data: filtered }] : []);
      return;
    }
    setSections(
      viewMode === 'books'
        ? groupExcerptFeedByBook(feed)
        : groupExcerptFeedItems(feed, GROUP_LABELS),
    );
  }, [feed, viewMode, query]);

  // Excerpts Tab Core C: Source 行是唯一的原文入口。点按时先做 stale 检查
  // （书可能在 Feed 建好后被删除），再发布 one-shot 内存导航请求并打开
  // Reader。Quote 已展开时点 Source 直接导航，不先收起、不改 expandedItemId。
  //
  // 快速连点不同 Source 的 sequence 守卫：只有最后一次点击能走完导航，
  // 旧的异步查询回来后发现过期就直接丢弃，不覆盖新点击。
  const sourceNavSeqRef = useRef(0);
  const handleSourcePress = useCallback(async (item: ExcerptFeedItem) => {
    const seq = ++sourceNavSeqRef.current;
    const book = await bookRepository.getBookById(item.bookId).catch(() => null);
    if (seq !== sourceNavSeqRef.current) {
      if (__DEV__) console.log('[EXCERPT_NAVIGATE]', JSON.stringify({ bookId: item.bookId, itemKind: item.kind, aborted: 'superseded' }));
      return;
    }
    if (!book) {
      if (__DEV__) console.log('[EXCERPT_NAVIGATE]', JSON.stringify({ bookId: item.bookId, itemKind: item.kind, aborted: 'book-missing' }));
      // 书已不存在：提示后刷新 Feed 让 stale item 消失，不进入空 Reader。
      Alert.alert(uiText.reader.cannotOpen, '这本书可能已被删除。');
      void loadFeed();
      return;
    }
    // 畸形 CFI 不在 Excerpts 层拦截：照常发布请求并进 Reader，
    // Reader 在 open 时校验、回退到 saved progress 并提示（spec）。
    const request = createReaderExternalNavigationRequest(item.bookId, item.rangeCfi);
    if (__DEV__) {
      console.log('[EXCERPT_NAVIGATE]', JSON.stringify({
        bookId: item.bookId,
        itemKind: item.kind,
        requestId: request.id,
        cfiLength: item.rangeCfi.length,
      }));
    }
    router.push({ pathname: '/reader/[bookId]', params: { bookId: item.bookId } });
  }, [loadFeed, router]);

  // Tab focus 时刷新：Reader 新增摘录后返回即能看到最新数据。
  // useFocusEffect 在初次挂载时也会执行，覆盖首屏加载。
  useFocusEffect(
    useCallback(() => {
      void loadFeed();
    }, [loadFeed]),
  );

  if (sections === null) {
    // 本地 SQLite 查询通常几十毫秒：宁可短暂空白，不闪 spinner。
    return <View style={styles.screen} />;
  }

  return (
    <View style={styles.screen}>
      <SectionList<ExcerptFeedItem, ExcerptFeedSection>
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 2, paddingBottom: insets.bottom + 32 },
        ]}
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Text accessibilityRole="header" style={[styles.largeTitle, styles.headerTitle]}>
              {uiText.excerpts.title}
            </Text>
            <View style={styles.searchBox}>
              <Text style={styles.searchIcon}>􀊫</Text>
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder={uiText.excerpts.searchPlaceholder}
                placeholderTextColor={tokens.colors.tertiaryLabel}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => {
          // Excerpts Tab Core E：books mode 的 section header = 书名（左，flex:1
          // 单行省略）+ N条（右，secondary label，固定自然宽度不被挤掉）。
          // 无 badge / 胶囊 / icon / 封面 / chevron，与 time header 同样克制。
          if (section.kind === 'book') {
            return (
              <View style={styles.bookSectionHeader}>
                <Text
                  style={[styles.sectionTitle, styles.bookSectionTitle]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {section.title}
                </Text>
                <Text style={styles.bookCount}>
                  {uiText.excerpts.bookExcerptCount(section.count ?? section.data.length)}
                </Text>
              </View>
            );
          }
          return <Text style={styles.sectionTitle}>{section.title}</Text>;
        }}
        renderItem={({ item, index, section }) => {
          const info = truncInfo[item.id];
          const measured = info && info.text === item.quoteText ? info : undefined;
          return (
            <ExcerptFeedItemRow
              item={item}
              viewMode={viewMode}
              isFirst={index === 0}
              isLast={index === section.data.length - 1}
              isExpanded={expandedItemId === item.id}
              isTruncated={measured?.truncated}
              fullHeight={measured?.fullHeight ?? 0}
              onToggleExpand={toggleExpand}
              onTruncationMeasured={handleTruncationMeasured}
              onSourcePress={handleSourcePress}
            />
          );
        }}
        ItemSeparatorComponent={() => (
          <View style={styles.separatorWrap}>
            <View style={styles.separator} />
          </View>
        )}
        SectionSeparatorComponent={() => <View style={styles.sectionGap} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <SymbolView
              name="text.quote"
              size={48}
              tintColor={tokens.colors.tertiaryLabel}
            />
            <Text style={styles.emptyTitle}>
              {query.trim() ? uiText.excerpts.searchEmptyTitle : uiText.excerpts.emptyTitle}
            </Text>
            <Text style={styles.emptyHint}>
              {query.trim() ? uiText.excerpts.searchEmptyHint : uiText.excerpts.emptyHint}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.colors.groupedBackground,
  },
  content: {
    paddingHorizontal: CONTENT_HORIZONTAL_PADDING,
  },
  largeTitle: {
    color: tokens.colors.label,
    fontSize: tokens.typography.largeTitle,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 40,
    marginBottom: 12,
  },
  /** 标题行：摘录（左，flex:1）+ 搜索框（右）。 */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    flex: 1,
    marginBottom: 0,
  },
  /** iOS 风格搜索框：圆角 + 系统填充灰背景，紧凑宽度放标题右侧。 */
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.colors.fill,
    borderRadius: 10,
    paddingHorizontal: 8,
    height: 32,
    width: 150,
    marginLeft: 12,
  },
  searchIcon: {
    color: tokens.colors.secondaryLabel,
    fontSize: 15,
    marginRight: 4,
  },
  searchInput: {
    flex: 1,
    color: tokens.colors.label,
    fontSize: 15,
    paddingVertical: 0,
  },
  sectionTitle: {
    color: tokens.colors.label,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 28,
    marginBottom: 12,
  },
  /**
   * Excerpts Tab Core E：books mode 的 section header 行。
   * 书名左（flex:1，单行省略，数量不被挤掉）+ N条右（secondary label）。
   * margin 从 sectionTitle 搬到容器，避免双倍间距。
   */
  bookSectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 28,
    marginBottom: 12,
  },
  bookSectionTitle: {
    flex: 1,
    marginTop: 0,
    marginBottom: 0,
  },
  bookCount: {
    color: tokens.colors.secondaryLabel,
    fontSize: 15,
    marginLeft: 8,
  },
  item: {
    backgroundColor: tokens.colors.groupedCell,
    paddingHorizontal: ITEM_HORIZONTAL_PADDING,
    paddingVertical: 12,
  },
  itemFirst: {
    borderTopLeftRadius: CELL_RADIUS,
    borderTopRightRadius: CELL_RADIUS,
  },
  itemLast: {
    borderBottomLeftRadius: CELL_RADIUS,
    borderBottomRightRadius: CELL_RADIUS,
  },
  separatorWrap: {
    backgroundColor: tokens.colors.groupedCell,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.colors.separator,
    // 从正文内容左边界开始，不横贯 container 最左侧圆角区域
    marginLeft: ITEM_HORIZONTAL_PADDING,
  },
  sectionGap: {
    height: 4,
  },
  quote: {
    color: tokens.colors.label,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
    // 右 inset 见 QUOTE_RIGHT_INSET：下在容器上，不下在 Text 自身。
  },
  /**
   * 不可见截断测量：与 quote 同款式、同宽度、无行数限制。
   * absolute + opacity 0 不占布局、不拦截触摸；left 与 item padding 对齐，
   * right 额外吃掉 QUOTE_RIGHT_INSET，保证测量宽度 = 可见正文宽度
   *（行数判定和 fullHeight 才准确）。
   */
  quoteMeasure: {
    position: 'absolute',
    left: ITEM_HORIZONTAL_PADDING,
    right: ITEM_HORIZONTAL_PADDING + QUOTE_RIGHT_INSET,
    top: 0,
    opacity: 0,
  },
  /**
   * 展开动画的裁剪容器：overflow hidden + Reanimated 高度动画，
   * 像窗帘一样揭示全文；文字本体在动画中不重排（高度冻结见 contentHeight）。
   * paddingRight = QUOTE_RIGHT_INSET：文字右端离裁剪边 6pt，
   * 窄 advance 标点墨水不被拦腰切断。
   */
  quoteClip: {
    overflow: 'hidden',
    paddingRight: QUOTE_RIGHT_INSET,
  },
  /**
   * 短摘录（不截断、不可展开）的正文容器：只吃右 inset，
   * 与可展开卡片的正文右边界对齐；无裁剪、无动画。
   */
  quoteStaticWrap: {
    paddingRight: QUOTE_RIGHT_INSET,
  },
  note: {
    color: tokens.colors.secondaryLabel,
    fontSize: 15,
    lineHeight: 20,
    marginTop: 6,
  },
  source: {
    color: tokens.colors.secondaryLabel,
    fontSize: 15,
    lineHeight: 20,
  },
  // Source 按压容器：alignSelf 让热区贴着文字，不扩成整个 item。
  sourcePressable: {
    alignSelf: 'flex-start',
    marginTop: 6,
    maxWidth: '100%',
  },
  sourcePressed: {
    opacity: 0.65,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 120,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: tokens.colors.label,
    fontSize: tokens.typography.sectionTitle,
    fontWeight: '600',
    marginTop: 16,
  },
  emptyHint: {
    color: tokens.colors.secondaryLabel,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
  },
});
