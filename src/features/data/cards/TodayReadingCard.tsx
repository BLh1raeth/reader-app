import { StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import { DataCard } from '../DataCard';
import { formatDuration } from '../analytics-format';
import { cardColors } from './cardColors';

type TodayReadingCardProps = {
  /** summary.todayActiveSeconds；null = 未加载，显示占位。 */
  activeSeconds: number | null;
  /** summary.todayForwardCharacters；null = 未加载，显示占位。 */
  forwardCharacters: number | null;
  /** summary.todayExcerptCount；null = 未加载，显示占位。 */
  excerptCount: number | null;
};

/**
 * Data Tab Core B.3：今日阅读主卡（页面唯一的视觉中心）。
 *
 * 只展示真实发生的数据：今日阅读时长（最大主值）、今日阅读字数、
 * 今日摘录数。没有目标完成率、没有评分、没有百分制。
 *
 * 底部一句 deterministic 事实型摘要（无价值判断、无 AI）：
 * - 有时长且有字数 → “今天你已经阅读了 X 字。”
 * - 有时长、有摘录、无字数 → “今天你记录了 X 条摘录。”
 * - 有时长、无字数无摘录 → “今天你已阅读 X 分钟。”
 * - 今日 0 秒 → “开始阅读后，这里会显示你今天的阅读数据。”
 *
 * zero state 完整显示 0 分钟 / 0 字 / 0 条，不留空。
 */
export function TodayReadingCard({
  activeSeconds,
  forwardCharacters,
  excerptCount,
}: TodayReadingCardProps) {
  const loaded = activeSeconds !== null && forwardCharacters !== null && excerptCount !== null;

  const durationText = activeSeconds === null ? '—' : formatDuration(activeSeconds);
  const charsText =
    forwardCharacters === null ? '—' : `${forwardCharacters}${uiText.data.characterUnit}`;
  const excerptText = excerptCount === null ? '—' : `${excerptCount}${uiText.data.excerptUnit}`;

  const summaryText = !loaded
    ? '—'
    : activeSeconds === 0
      ? uiText.data.todaySummaryZero
      : forwardCharacters > 0
        ? uiText.data.todaySummaryChars(forwardCharacters)
        : excerptCount > 0
          ? uiText.data.todaySummaryExcerpts(excerptCount)
          : uiText.data.todaySummaryDuration(durationText);

  return (
    <DataCard
      accessible
      accessibilityLabel={`今日阅读：今天阅读${durationText}，阅读${charsText}，摘录${excerptText}。${summaryText}`}
      style={styles.card}
    >
      <Text style={styles.title}>{uiText.data.todayReadingTitle}</Text>

      <Text
        style={styles.bigValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {durationText}
      </Text>

      <View style={styles.auxRow}>
        <View style={styles.auxCol}>
          <Text style={styles.auxLabel}>{uiText.data.todayCharsLabel}</Text>
          <Text
            style={styles.auxCharsValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {charsText}
          </Text>
        </View>
        <View style={styles.auxCol}>
          <Text style={styles.auxLabel}>{uiText.data.excerpts}</Text>
          <Text
            style={styles.auxValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {excerptText}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <Text style={styles.summary}>{summaryText}</Text>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
  },
  title: {
    color: cardColors.primary,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
  },
  /** 今日阅读时长：卡内最大数字，主蓝色。 */
  bigValue: {
    color: cardColors.primary,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 40,
  },
  auxRow: {
    flexDirection: 'row',
    marginTop: 18,
  },
  auxCol: {
    flex: 1,
  },
  auxLabel: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
    marginBottom: 4,
  },
  /** 今日阅读字数：偏青（主色同系），是本卡第二视觉点。 */
  auxCharsValue: {
    color: cardColors.secondary,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  /** 今日摘录：中性色，不抢视觉。 */
  auxValue: {
    color: tokens.colors.label,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.colors.separator,
    marginVertical: 14,
  },
  summary: {
    color: tokens.colors.label,
    fontSize: 15,
    lineHeight: 21,
  },
});
