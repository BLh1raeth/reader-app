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
  runOnJS,
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
 * 可展开的正文：窗帘式高度动画 + 行尾交叉淡化。
 *
 * 防闪关键有两层：
 * 1. 高度动画中文字本体永不重排——全文只排一次版，动画只改变外层容器的
 *    裁剪高度（overflow hidden + Reanimated height，UI 线程）。
 * 2. 省略号版↔全文版的切换不做硬切：动画期间两个版本叠放（全文版在下恒为
 *    不透明，省略号版盖在上面），用 150ms 淡入/淡出完成行尾"…"到续写文字的
 *    交叉淡化；其余相同的行在淡化中像素一致，视觉上只有行尾在溶解。
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
  const [showFullText, setShowFullText] = useState(false);
  const [showEllipsisText, setShowEllipsisText] = useState(true);
  const heightSV = useSharedValue(COLLAPSED_QUOTE_HEIGHT);
  // 省略号覆盖层的透明度：1 = 收起态完全盖住，0 = 展开态完全让出（底下是全文版）。
  const ellipsisOpacitySV = useSharedValue(1);
  const isExpandedRef = useRef(isExpanded);
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
  const ellipsisOpacityStyle = useAnimatedStyle(() => ({
    opacity: ellipsisOpacitySV.value,
  }));

  // 高度动画播完（runOnJS 回到 JS 线程）再卸载不再需要的版本；
  // 用 isExpandedRef 防"播完→用户又点了反向"的竞态。
  const handleExpandFinished = useCallback(() => {
    if (isExpandedRef.current) setShowEllipsisText(false);
  }, []);
  const handleCollapseFinished = useCallback(() => {
    if (!isExpandedRef.current) setShowFullText(false);
  }, []);

  useEffect(() => {
    isExpandedRef.current = isExpanded;
    const targetHeight = isExpanded
      ? Math.max(fullHeight, COLLAPSED_QUOTE_HEIGHT)
      : COLLAPSED_QUOTE_HEIGHT;
    if (reduceMotionRef.current) {
      heightSV.value = targetHeight;
      ellipsisOpacitySV.value = isExpanded ? 0 : 1;
      setShowFullText(isExpanded);
      setShowEllipsisText(!isExpanded);
      return;
    }
    if (isExpanded) {
      // 展开：全文版已挂在省略号版底下（被不透明盖住、不可见），
      // 把省略号版 150ms 淡出——行尾"…"溶解成续写文字；
      // 同时高度 44→全文 400ms 徐徐揭示。
      setShowFullText(true);
      ellipsisOpacitySV.value = withTiming(0, {
        duration: 150,
        easing: Easing.out(Easing.quad),
      });
    } else {
      // 收起：省略号版以透明状态盖到全文版上，150ms 淡入完成行尾交叉淡化；
      // 高度 全文→44 400ms 像窗帘一样盖住下面的行；播完再卸载全文版。
      // （中途反向点选时 withTiming 会从当前值平滑反转，无需额外处理。）
      setShowEllipsisText(true);
      ellipsisOpacitySV.value = withTiming(1, {
        duration: 150,
        easing: Easing.out(Easing.quad),
      });
    }
    heightSV.value = withTiming(
      targetHeight,
      { duration: EXPAND_ANIMATION_DURATION, easing: Easing.inOut(Easing.ease) },
      (finished) => {
        // 被新动画打断（finished=false）时不卸载，交给新动画的收尾处理。
        if (!finished) return;
        if (isExpanded) runOnJS(handleExpandFinished)();
        else runOnJS(handleCollapseFinished)();
      },
    );
  }, [
    isExpanded,
    fullHeight,
    handleExpandFinished,
    handleCollapseFinished,
    heightSV,
    ellipsisOpacitySV,
  ]);

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
        {showFullText ? (
          <Text style={styles.quote}>{item.quoteText}</Text>
        ) : null}
        {showEllipsisText ? (
          <Animated.Text
            style={[styles.quote, styles.ellipsisOverlay, ellipsisOpacityStyle]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {item.quoteText}
          </Animated.Text>
        ) : null}
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
        quote
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
  },
  /**
   * 不可见截断测量：与 quote 同款式、同宽度、无行数限制。
   * absolute + opacity 0 不占布局、不拦截触摸；left/right 与 item padding
   * 对齐，保证测量宽度 = 可见正文宽度（行数判定才准确）。
   */
  quoteMeasure: {
    position: 'absolute',
    left: ITEM_HORIZONTAL_PADDING,
    right: ITEM_HORIZONTAL_PADDING,
    top: 0,
    opacity: 0,
  },
  /**
   * 展开动画的裁剪容器：overflow hidden + Reanimated 高度动画，
   * 像窗帘一样揭示全文；文字本体在动画中不重排。
   */
  quoteClip: {
    overflow: 'hidden',
  },
  /**
   * 省略号覆盖层：动画期间盖在全文版之上做交叉淡化。
   * absolute 铺满容器宽度，保证与底下全文版断行完全一致（淡化中只有行尾在变化）。
   */
  ellipsisOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
