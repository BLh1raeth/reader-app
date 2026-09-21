import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
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
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import {
  groupExcerptFeedItems,
  type ExcerptFeedSection,
} from './excerpt-feed-grouping';
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
// 注意：inset 必须下在容器上，不能下在 <Text> 自身——RN iOS 里 Text 的
// padding 由原生文本容器（NSTextContainer）处理，多次 layout pass 算出的
// 容器宽度可能差一丁点，每次点击都会让中文断行重排（2026-09-21 真机复现）。
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
      ? Math.max(fullHeight, COLLAPSED_QUOTE_HEIGHT)
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
  }, [isExpanded, fullHeight, heightSV]);

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
        <Text style={styles.quote}>{item.quoteText}</Text>
      </Animated.View>
    </Pressable>
  );
}

function ExcerptFeedItemRow({
  item,
  isFirst,
  isLast,
  isExpanded,
  isTruncated,
  fullHeight,
  onToggleExpand,
  onTruncationMeasured,
}: {
  item: ExcerptFeedItem;
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
      <Text
        style={styles.source}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {sourceLine(item)}
      </Text>
    </View>
  );
}

export default function ExcerptsScreen() {
  const insets = useSafeAreaInsets();
  // null = loading（与 empty 区分开，避免 empty → 列表一闪而过）
  const [sections, setSections] = useState<ExcerptFeedSection[] | null>(null);
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
      setSections(groupExcerptFeedItems(items, GROUP_LABELS));
    } catch (error) {
      if (__DEV__) console.error('[EXCERPT_FEED_LOAD_FAILED]', error);
      // 加载失败时保持旧数据，不闪成 empty state
    }
  }, []);

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
          <Text accessibilityRole="header" style={styles.largeTitle}>
            {uiText.excerpts.title}
          </Text>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        renderItem={({ item, index, section }) => {
          const info = truncInfo[item.id];
          const measured = info && info.text === item.quoteText ? info : undefined;
          return (
            <ExcerptFeedItemRow
              item={item}
              isFirst={index === 0}
              isLast={index === section.data.length - 1}
              isExpanded={expandedItemId === item.id}
              isTruncated={measured?.truncated}
              fullHeight={measured?.fullHeight ?? 0}
              onToggleExpand={toggleExpand}
              onTruncationMeasured={handleTruncationMeasured}
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
            <Text style={styles.emptyTitle}>{uiText.excerpts.emptyTitle}</Text>
            <Text style={styles.emptyHint}>{uiText.excerpts.emptyHint}</Text>
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
  sectionTitle: {
    color: tokens.colors.label,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 28,
    marginBottom: 12,
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
    // 右 inset 见 QUOTE_RIGHT_INSET：下在容器（quoteClip / quoteStaticWrap /
    // quoteMeasure）上，不下在 Text 自身，避免 iOS 原生文本容器多次 layout
    // 算出不同宽度导致断行漂移。
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
   * 像窗帘一样揭示全文；文字本体在动画中不重排。
   * paddingRight = QUOTE_RIGHT_INSET：文字右端离裁剪边 6pt，
   * 窄 advance 标点墨水不被拦腰切断（原先下在 Text 上，会触发断行漂移）。
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
    marginTop: 6,
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
