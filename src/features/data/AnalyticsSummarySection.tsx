import { StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import type { ReadingAnalyticsSummary } from './reading-analytics-types';
import { formatCount, formatDuration, formatReadingSpeed } from './analytics-format';

type SummaryRow = {
  key: string;
  label: string;
  value: string;
  /** 供 VoiceOver 自然朗读的完整文案。 */
  accessibilityLabel: string;
};

/**
 * Data Tab Core B：摘要 Section。
 *
 * 单个 grouped container 多行 row，无 chevron、不可点击（详情页未实现，
 * 不做 dead affordance）。row 朗读自然，不给 button role。
 */
export function AnalyticsSummarySection({ summary }: { summary: ReadingAnalyticsSummary }) {
  const rows: SummaryRow[] = [
    {
      key: 'duration',
      label: uiText.data.totalReadingTime,
      value: formatDuration(summary.totalActiveSeconds),
      accessibilityLabel: `${uiText.data.totalReadingTime}，${formatDuration(summary.totalActiveSeconds)}`,
    },
    {
      key: 'speed',
      label: uiText.data.readingSpeed,
      value: formatReadingSpeed(summary.last7DaysReadingSpeedCharsPerMinute),
      accessibilityLabel: `${uiText.data.readingSpeed}，${
        summary.last7DaysReadingSpeedCharsPerMinute === null
          ? '—'
          : `${Math.round(summary.last7DaysReadingSpeedCharsPerMinute)} 字每分钟`
      }`,
    },
    {
      key: 'streak',
      label: uiText.data.currentStreak,
      value: formatCount(summary.currentStreakDays, uiText.data.dayUnit),
      accessibilityLabel: `${uiText.data.currentStreak}，${summary.currentStreakDays} 天`,
    },
    {
      key: 'days',
      label: uiText.data.totalReadingDays,
      value: formatCount(summary.totalReadingDays, uiText.data.dayUnit),
      accessibilityLabel: `${uiText.data.totalReadingDays}，${summary.totalReadingDays} 天`,
    },
    {
      key: 'excerpts',
      label: uiText.data.excerpts,
      value: formatCount(summary.totalExcerptCount, uiText.data.excerptUnit),
      accessibilityLabel: `${uiText.data.excerpts}，${summary.totalExcerptCount} 条`,
    },
  ];

  return (
    <View>
      <Text style={styles.title}>{uiText.data.summary}</Text>
      <View style={styles.container}>
        {rows.map((row, index) => (
          <View key={row.key}>
            <View accessible accessibilityLabel={row.accessibilityLabel} style={styles.row}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
            {index < rows.length - 1 && (
              <View style={styles.separatorWrap}>
                <View style={styles.separator} />
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    color: tokens.colors.label,
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  container: {
    backgroundColor: tokens.colors.groupedCell,
    borderRadius: 26,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  label: {
    color: tokens.colors.label,
    fontSize: 17,
  },
  value: {
    color: tokens.colors.secondaryLabel,
    fontSize: 17,
    fontWeight: '500',
  },
  separatorWrap: {
    backgroundColor: tokens.colors.groupedCell,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.colors.separator,
    marginLeft: 16,
  },
});
