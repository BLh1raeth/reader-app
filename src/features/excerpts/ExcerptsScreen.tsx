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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
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
// 底部渐隐罩：高 26pt（约一行多一点），钉在裁剪容器底边；
// 展开/收起时 180ms 淡出/淡入，替代"…"作为"还有更多"的信号。
const FADE_OVERLAY_HEIGHT = 26;
const FADE_ANIMATION_DURATION = 180;

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
 * 可展开的正文：窗帘式高度动画 + 底部渐隐罩。
 *
 * 彻底防"行尾跳变"的关键：正文永远渲染全文（无 numberOfLines、无"…"），
 * 收起态只是被容器裁到 44 高——前两行与展开态像素级一致，动画全程文字
 * 本体零变化、零重排。唯一的动效是：高度 400ms easeInOut（UI 线程）+
 * 底部渐隐罩 180ms 淡出/淡入（"还有更多"的信号，替代省略号）。
 * 渐隐罩钉在裁剪容器底边，随高度动画"洗下去"/"升回来"。
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
  // 渐隐罩是否挂载：收起态（含收起动画）需要它，展开播完后卸载。
  const [showFade, setShowFade] = useState(true);
  const heightSV = useSharedValue(COLLAPSED_QUOTE_HEIGHT);
  // 渐隐罩透明度：1 = 收起态完全显示，0 = 展开态完全消失。
  const fadeOpacitySV = useSharedValue(1);
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
  const fadeOpacityStyle = useAnimatedStyle(() => ({
    opacity: fadeOpacitySV.value,
  }));

  // 展开动画播完（runOnJS 回到 JS 线程）再卸载渐隐罩；
  // 用 isExpandedRef 防"播完→用户又点了收起"的竞态。
  // 收起播完无需卸载——收起态本来就要显示渐隐罩。
  const handleExpandFinished = useCallback(() => {
    if (isExpandedRef.current) setShowFade(false);
  }, []);

  useEffect(() => {
    isExpandedRef.current = isExpanded;
    const targetHeight = isExpanded
      ? Math.max(fullHeight, COLLAPSED_QUOTE_HEIGHT)
      : COLLAPSED_QUOTE_HEIGHT;
    if (reduceMotionRef.current) {
      heightSV.value = targetHeight;
      fadeOpacitySV.value = isExpanded ? 0 : 1;
      setShowFade(!isExpanded);
      return;
    }
    if (isExpanded) {
      // 展开：渐隐罩 180ms 淡出（它钉在容器底边，随高度增长"洗下去"的同时消失），
      // 高度 44→全文 400ms 徐徐揭示；播完卸载渐隐罩。
      // 文字本体全程零变化——收起态看到的本就是全文的前两行。
      fadeOpacitySV.value = withTiming(0, {
        duration: FADE_ANIMATION_DURATION,
        easing: Easing.out(Easing.quad),
      });
    } else {
      // 收起：渐隐罩以透明状态挂上，180ms 淡入；
      // 高度 全文→44 400ms 像窗帘一样盖住下面的行。
      // （中途反向点选时 withTiming 会从当前值平滑反转，无需额外处理。）
      setShowFade(true);
      fadeOpacitySV.value = withTiming(1, {
        duration: FADE_ANIMATION_DURATION,
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
      },
    );
  }, [
    isExpanded,
    fullHeight,
    handleExpandFinished,
    heightSV,
    fadeOpacitySV,
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
        <Text style={styles.quote}>{item.quoteText}</Text>
        {showFade ? (
          <Animated.View
            style={[styles.fadeOverlay, fadeOpacityStyle]}
            pointerEvents="none"
          >
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="quoteFade" x1="0" y1="0" x2="0" y2="1">
                  <Stop
                    offset="0"
                    stopColor={tokens.colors.groupedCell}
                    stopOpacity={0}
                  />
                  <Stop
                    offset="1"
                    stopColor={tokens.colors.groupedCell}
                    stopOpacity={1}
                  />
                </LinearGradient>
              </Defs>
              <Rect
                x={0}
                y={0}
                width="100%"
                height="100%"
                fill="url(#quoteFade)"
              />
            </Svg>
          </Animated.View>
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
    // 右 inset：收起态是"裸文本 + 容器硬裁"（无省略号），iOS 按像素裁剪；
    // 窄 advance 的 CJK 标点（如"、"）字形墨水会超出 advance 被拦腰切断。
    // 6pt 让断行提前，字形墨水不贴裁剪边（禁则规则会把标点带下行）。
    // 三处共用（可见正文/隐藏测量/短摘录），断行与 fullHeight 测量保持一致。
    paddingRight: 6,
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
   * 底部渐隐罩：替代"…"作为"还有更多"的信号。钉在裁剪容器底边，
   * 随高度动画移动；stopOpacity 做 0→1 渐变，stopColor 取 cell 背景
   * （PlatformColor，深浅色自动跟），文字在其下方向背景色溶解。
   */
  fadeOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: FADE_OVERLAY_HEIGHT,
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
