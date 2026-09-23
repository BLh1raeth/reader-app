import { PlatformColor, StyleSheet, Text, View } from 'react-native';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';

type ReadingSpeedCardProps = {
  /** summary.last7DaysReadingSpeedCharsPerMinute；null = 未加载或无有效数据。 */
  speed: number | null;
  /** 最近 7 天每天的 readingSpeedCharsPerMinute；null = 未加载。 */
  days: DailyReadingStats[] | null;
};

const CHART_HEIGHT = 44;
const MIN_VISIBLE_BAR_HEIGHT = 3;

/**
 * Data Tab Core B.1：“阅读速度”卡。
 *
 * 主值忠实显示 Analytics 输出：null → —；不 clamp、不隐藏异常值
 * （数据质量问题留给独立审计，UI 不掩盖）。超长数字用
 * adjustsFontSizeToFit 保证不撑破 layout。
 *
 * mini chart：只画非 null 的 day；null day 不画有效柱（不把 null 当 0）。
 */
export function ReadingSpeedCard({ speed, days }: ReadingSpeedCardProps) {
  const list = days ?? [];
  const validSpeeds = list
    .map((d) => d.readingSpeedCharsPerMinute)
    .filter((v): v is number => v !== null);
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 0;

  const valueText = speed === null ? '—' : `${Math.round(speed)}`;
  const a11yValue =
    speed === null ? '—' : `${Math.round(speed)}字每分钟`;

  return (
    <DataCard accessible accessibilityLabel={`${uiText.data.readingSpeed}，${a11yValue}`}>
      <Text style={styles.title}>{uiText.data.readingSpeed}</Text>
      <View style={styles.valueRow}>
        <Text
          style={styles.value}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {valueText}
        </Text>
        {speed !== null ? <Text style={styles.unit}>{uiText.data.speedUnit}</Text> : null}
      </View>
      <View style={styles.barsRow} accessible={false}>
        {list.map((day) => {
          const daySpeed = day.readingSpeedCharsPerMinute;
          let barHeight = 0;
          if (daySpeed !== null && maxSpeed > 0) {
            barHeight = Math.max(
              MIN_VISIBLE_BAR_HEIGHT,
              Math.round((daySpeed / maxSpeed) * CHART_HEIGHT),
            );
          }
          return (
            <View key={day.dayKey} style={styles.barColumn}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { height: barHeight },
                    daySpeed !== null ? styles.barFillValid : styles.barFillNull,
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
    </DataCard>
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
  barsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 5,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    height: CHART_HEIGHT,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: 12,
    borderRadius: 4,
  },
  barFillValid: {
    backgroundColor: PlatformColor('systemBlue'),
  },
  /** null day：不画有效柱，用极浅占位表示“无数据”，不伪造 0。 */
  barFillNull: {
    backgroundColor: PlatformColor('tertiarySystemFill'),
    opacity: 0.5,
  },
});
