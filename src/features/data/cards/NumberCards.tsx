import { StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import { DataCard } from '../DataCard';

type NumberCardProps = {
  title: string;
  /** 主值；null = 尚未加载完成，显示占位。 */
  value: number | null;
  unit: string;
  hint: string;
  accessibilityLabel: string;
};

function NumberCard({ title, value, unit, hint, accessibilityLabel }: NumberCardProps) {
  return (
    <DataCard accessible accessibilityLabel={accessibilityLabel}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.valueRow}>
        <Text
          style={styles.value}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {value === null ? '—' : `${value}`}
        </Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </DataCard>
  );
}

/** 连续阅读：summary.currentStreakDays。数字卡，不套圆环。 */
export function ReadingStreakCard({ streakDays }: { streakDays: number | null }) {
  return (
    <NumberCard
      title={uiText.data.currentStreak}
      value={streakDays}
      unit={uiText.data.dayUnit}
      hint={uiText.data.currentStreakHint}
      accessibilityLabel={
        streakDays === null
          ? `${uiText.data.currentStreak}`
          : `当前连续阅读${streakDays}天`
      }
    />
  );
}

/** 阅读天数：summary.totalReadingDays。 */
export function ReadingDaysCard({ totalDays }: { totalDays: number | null }) {
  return (
    <NumberCard
      title={uiText.data.totalReadingDays}
      value={totalDays}
      unit={uiText.data.dayUnit}
      hint={uiText.data.totalHint}
      accessibilityLabel={
        totalDays === null ? `${uiText.data.totalReadingDays}` : `累计阅读${totalDays}天`
      }
    />
  );
}

/** 摘录：summary.totalExcerptCount。 */
export function ExcerptCountCard({ excerptCount }: { excerptCount: number | null }) {
  return (
    <NumberCard
      title={uiText.data.excerpts}
      value={excerptCount}
      unit={uiText.data.excerptUnit}
      hint={uiText.data.totalHint}
      accessibilityLabel={
        excerptCount === null ? `${uiText.data.excerpts}` : `累计摘录${excerptCount}条`
      }
    />
  );
}

const styles = StyleSheet.create({
  title: {
    color: tokens.colors.label,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  value: {
    color: tokens.colors.label,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  unit: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
    marginLeft: 4,
  },
  hint: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
  },
});
