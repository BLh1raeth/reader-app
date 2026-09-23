import { StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import { DataCard } from '../DataCard';

type AccumulationCardProps = {
  /** summary.currentStreakDays；null = 未加载。 */
  streakDays: number | null;
  /** summary.totalReadingDays；null = 未加载。 */
  totalDays: number | null;
  /** summary.totalExcerptCount；null = 未加载。 */
  excerptCount: number | null;
};

/**
 * Data Tab Core B.2：阅读积累（页面最低视觉权重）。
 *
 * 一张全宽 compact card，内部三个文本 column，不套嵌套小卡；
 * 列之间用很轻的 vertical hairline 分隔。
 * 数字用 label 色（不按指标着色），靠层级而非颜色区分。
 */
export function AccumulationCard({ streakDays, totalDays, excerptCount }: AccumulationCardProps) {
  const streakText = streakDays === null ? '—' : `${streakDays}${uiText.data.dayUnit}`;
  const daysText = totalDays === null ? '—' : `${totalDays}${uiText.data.dayUnit}`;
  const excerptText = excerptCount === null ? '—' : `${excerptCount}${uiText.data.excerptUnit}`;

  return (
    <DataCard
      accessible
      accessibilityLabel={`${uiText.data.readingAccumulation}：${uiText.data.currentStreak}${streakText}，${uiText.data.totalReadingDays}${daysText}，${uiText.data.excerpts}${excerptText}`}
    >
      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>{uiText.data.currentStreak}</Text>
          <Text
            style={styles.value}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {streakText}
          </Text>
          <Text style={styles.hint}>{uiText.data.currentHint}</Text>
        </View>
        <View style={[styles.col, styles.colSeparated]}>
          <Text style={styles.label}>{uiText.data.totalReadingDays}</Text>
          <Text
            style={styles.value}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {daysText}
          </Text>
          <Text style={styles.hint}>{uiText.data.totalHint}</Text>
        </View>
        <View style={[styles.col, styles.colSeparated]}>
          <Text style={styles.label}>{uiText.data.excerpts}</Text>
          <Text
            style={styles.value}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {excerptText}
          </Text>
          <Text style={styles.hint}>{uiText.data.totalHint}</Text>
        </View>
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  col: {
    flex: 1,
    alignItems: 'center',
  },
  /** 列之间的轻分隔线：hairline，不抢视觉。 */
  colSeparated: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: tokens.colors.separator,
  },
  label: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
    marginBottom: 6,
  },
  value: {
    color: tokens.colors.label,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  hint: {
    color: tokens.colors.secondaryLabel,
    fontSize: 12,
    marginTop: 6,
  },
});
