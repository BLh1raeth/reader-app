import { StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import { DataCard, DATA_HERO_RADIUS } from '../DataCard';
import { formatDuration } from '../analytics-format';
import { cardColors } from './cardColors';

type TodayReadingCardProps = {
  /** 今日有效阅读秒数；null = 尚未加载完成，显示占位。 */
  todayActiveSeconds: number | null;
  /** 过去 7 个完整自然日日均；null = 尚未加载完成。 */
  baselineActiveSeconds: number | null;
};

/** Core B 已定义的今日 vs 过去 7 天日均文案逻辑，语义不变。 */
function helperText(today: number | null, baseline: number | null): string {
  if (today === null || baseline === null) return '—';
  if (baseline === 0) {
    return today > 0 ? uiText.data.startTracking : uiText.data.startReadingHint;
  }
  const diffSeconds = Math.round((today - baseline) / 60) * 60;
  if (diffSeconds === 0) return uiText.data.aboutAverage;
  const diffText = formatDuration(Math.abs(diffSeconds));
  return diffSeconds > 0
    ? uiText.data.moreThanAverage(diffText)
    : uiText.data.lessThanAverage(diffText);
}

/**
 * Data Tab Core B.1：今日阅读 Hero 卡。
 *
 * 全宽实体卡（非 Liquid Glass），以文字层级为主：小标题 / 大数字 / 辅助文案。
 */
export function TodayReadingCard({ todayActiveSeconds, baselineActiveSeconds }: TodayReadingCardProps) {
  const value = todayActiveSeconds === null ? '—' : formatDuration(todayActiveSeconds);
  const helper = helperText(todayActiveSeconds, baselineActiveSeconds);

  return (
    <DataCard
      accessible
      accessibilityLabel={`${uiText.data.todayReading}，${value}。${helper}`}
      style={styles.hero}
    >
      <Text style={styles.kicker}>{uiText.data.todayReading}</Text>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.helper}>{helper}</Text>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: DATA_HERO_RADIUS,
    padding: 22,
  },
  kicker: {
    color: cardColors.today,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  value: {
    color: cardColors.today,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 40,
  },
  helper: {
    color: tokens.colors.secondaryLabel,
    fontSize: 14,
    marginTop: 8,
  },
});
