import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { tokens } from '../../../design-system/tokens';
import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { formatDuration } from '../analytics-format';
import { cardColors } from './cardColors';

type ReadingTimeCardProps = {
  /** 最近 7 个 local calendar day（含今天），最旧 → 今天；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** 今天的 local day key，用于强调当天的柱子。 */
  todayKey: string;
  /** 7 日总量：summary.last7DaysActiveSeconds；null = 未加载。 */
  totalActiveSeconds: number | null;
};

const CHART_HEIGHT = 88;
const BAR_WIDTH = 8;
/** 0 秒的日子：极浅短 baseline，位置可见但不伪装成有数据。 */
const ZERO_BAR_HEIGHT = 6;
/** 非零值最小可见高度；0 秒保持 baseline，明确区分“没读”和“读了几秒”。 */
const MIN_VISIBLE_BAR_HEIGHT = 10;
const AXIS_DOT_SIZE = 5;

/** 无障碍短标签：9月17日，不带年份噪音。 */
function shortDateLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return `${m}月${d}日`;
}

/**
 * “阅读时长”半宽卡（视觉稿还原版）。
 *
 * 极简 7 日 spark bars + 底部总量：今天实蓝强调，其他非零日浅蓝，
 * 0 秒为浅灰 baseline；每根柱子下方一个小圆点作 x 轴刻度。
 * 右上 chevron 纯装饰（详情页未实现，卡片不可点）。
 */
export function ReadingTimeCard({ days, todayKey, totalActiveSeconds }: ReadingTimeCardProps) {
  const list = days ?? [];
  const maxSeconds = Math.max(0, ...list.map((d) => d.activeSeconds));
  const total = totalActiveSeconds === null ? '—' : formatDuration(totalActiveSeconds);

  const accessibilityParts = list
    .map((d) => `${shortDateLabel(d.dayKey)}${formatDuration(d.activeSeconds)}`)
    .join('，');

  return (
    <DataCard
      accessible
      accessibilityLabel={`${uiText.data.totalReadingTime}，过去 7 天总计${total}。${accessibilityParts}`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>{uiText.data.totalReadingTime}</Text>
        <SymbolView
          name="chevron.right"
          size={14}
          tintColor={tokens.colors.tertiaryLabel}
          weight="semibold"
        />
      </View>
      <View style={styles.chart} accessible={false}>
        <View style={styles.barsRow}>
          {list.map((day) => {
            const isToday = day.dayKey === todayKey;
            let barHeight = ZERO_BAR_HEIGHT;
            let barStyle = styles.barZero;
            if (day.activeSeconds > 0 && maxSeconds > 0) {
              barHeight = Math.max(
                MIN_VISIBLE_BAR_HEIGHT,
                Math.round((day.activeSeconds / maxSeconds) * CHART_HEIGHT),
              );
              barStyle = isToday ? styles.barToday : styles.barPast;
            }
            return (
              <View key={day.dayKey} style={styles.barColumn}>
                <View style={[styles.barFill, barStyle, { height: barHeight }]} />
                <View style={styles.axisDot} />
              </View>
            );
          })}
        </View>
      </View>
      <Text
        style={styles.total}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {total}
      </Text>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    flex: 1,
    color: cardColors.primary,
    fontSize: 18,
    fontWeight: '600',
  },
  chart: {
    height: CHART_HEIGHT + AXIS_DOT_SIZE + 8,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    height: CHART_HEIGHT,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
  barToday: {
    backgroundColor: cardColors.primary,
  },
  barPast: {
    backgroundColor: cardColors.primary,
    opacity: 0.45,
  },
  barZero: {
    backgroundColor: PlatformColor('tertiarySystemFill'),
  },
  /** 每根柱子下方的 x 轴小圆点。 */
  axisDot: {
    width: AXIS_DOT_SIZE,
    height: AXIS_DOT_SIZE,
    borderRadius: AXIS_DOT_SIZE / 2,
    backgroundColor: PlatformColor('tertiarySystemFill'),
    marginTop: 8,
  },
  total: {
    color: cardColors.primary,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginTop: 10,
  },
});
