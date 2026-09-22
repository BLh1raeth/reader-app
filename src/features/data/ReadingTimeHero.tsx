import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import { formatDuration } from './analytics-format';

type ReadingTimeHeroProps = {
  /** 今日有效阅读秒数：summary.todayActiveSeconds */
  todayActiveSeconds: number;
  /** 过去 7 个完整自然日日均：summary.previous7CompletedDaysAverageActiveSeconds */
  baselineActiveSeconds: number;
};

/**
 * Data Tab Core B：今日阅读 Hero。
 *
 * 只对比 today vs 过去 7 个完整自然日的日均，不使用 last7DaysActiveSeconds / 7。
 * 全部数据为 0 时也保留完整结构（0 分钟 + onboarding 文案），不整页替换。
 */
export function ReadingTimeHero({ todayActiveSeconds, baselineActiveSeconds }: ReadingTimeHeroProps) {
  const today = formatDuration(todayActiveSeconds);

  let helperText: string;
  if (baselineActiveSeconds === 0) {
    helperText =
      todayActiveSeconds > 0 ? uiText.data.startTracking : uiText.data.startReadingHint;
  } else {
    const diffSeconds = Math.round((todayActiveSeconds - baselineActiveSeconds) / 60) * 60;
    if (diffSeconds === 0) {
      helperText = uiText.data.aboutAverage;
    } else {
      const diffText = formatDuration(Math.abs(diffSeconds));
      helperText =
        diffSeconds > 0
          ? uiText.data.moreThanAverage(diffText)
          : uiText.data.lessThanAverage(diffText);
    }
  }

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${uiText.data.todayReading}，${today}。${helperText}`}
    >
      <Text style={styles.kicker}>{uiText.data.todayReading}</Text>
      <Text style={styles.value}>{today}</Text>
      <Text style={styles.helper}>{helperText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: {
    color: tokens.colors.secondaryLabel,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  value: {
    color: tokens.colors.label,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 40,
  },
  helper: {
    color: tokens.colors.secondaryLabel,
    fontSize: 14,
    marginTop: 6,
  },
});
