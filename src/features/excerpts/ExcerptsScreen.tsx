import { useCallback, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
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

const CELL_RADIUS = 20;
const CONTENT_HORIZONTAL_PADDING = 20;
const ITEM_HORIZONTAL_PADDING = 16;

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

function ExcerptFeedItemRow({
  item,
  isFirst,
  isLast,
}: {
  item: ExcerptFeedItem;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabelFor(item)}
      style={[
        styles.item,
        isFirst && styles.itemFirst,
        isLast && styles.itemLast,
      ]}
    >
      <Text
        style={styles.quote}
        numberOfLines={2}
        ellipsizeMode="tail"
      >
        {item.quoteText}
      </Text>
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

  const loadFeed = useCallback(async () => {
    try {
      const items = await listExcerptFeedItems();
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
        renderItem={({ item, index, section }) => (
          <ExcerptFeedItemRow
            item={item}
            isFirst={index === 0}
            isLast={index === section.data.length - 1}
          />
        )}
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
    backgroundColor: tokens.colors.background,
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
