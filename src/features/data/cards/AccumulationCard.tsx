import { StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { uiText } from '../../../localization';
import type { DailyReadingStats } from '../reading-analytics-types';
import { DataCard } from '../DataCard';
import { useDataTheme } from '../dataTheme';

type RhythmCardProps = {
  /** 最近 7 个 local calendar day（含今天），最旧 → 今天；null = 未加载。 */
  days: DailyReadingStats[] | null;
  /** summary.currentStreakDays；null = 未加载。 */
  streakDays: number | null;
  /** summary.totalReadingDays；null = 未加载。 */
  totalDays: number | null;
  /** summary.totalExcerptCount；null = 未加载。 */
  excerptCount: number | null;
};

/**
 * 阅读节奏卡（2026-09-24 视觉规范，页面底部大总结卡）。
 *
 * 顶部：书本图标 + 蓝色“阅读节奏”标题，右上蓝色“全部显示”（纯装饰）；
 * 加粗结论“最近 7 天，你有 X 天进行了阅读。”（X = 7 天内 activeSeconds > 0 的天数）；
 * 分割线；
 * 三列摘要：连续阅读（蓝，当前）/ 阅读天数（青，累计）/ 累计摘录（紫，累计），
 * 列之间很淡的竖分隔线。
 *
 * 所有数字来自 Analytics 实时数据，不写死。
 * 只消费 Analytics 已有输出，不重算口径、不碰统计逻辑。
 */
export function AccumulationCard({ days, streakDays, totalDays, excerptCount }: RhythmCardProps) {
  const theme = useDataTheme();
  const list = days ?? [];
  const activeDays7 = list.filter((d) => d.activeSeconds > 0).length;

  const streakText = streakDays === null ? '—' : `${streakDays}${uiText.data.dayUnit}`;
  const daysText = totalDays === null ? '—' : `${totalDays}${uiText.data.dayUnit}`;
  const excerptText = excerptCount === null ? '—' : `${excerptCount}${uiText.data.excerptUnit}`;

  const statement = days === null ? '—' : uiText.data.rhythmSummaryRecent(activeDays7);

  const columns = [
    {
      label: uiText.data.currentStreak,
      value: streakText,
      hint: uiText.data.currentHint,
      color: theme.blue,
    },
    {
      label: uiText.data.totalReadingDays,
      value: daysText,
      hint: uiText.data.totalHint,
      color: theme.teal,
    },
    {
      label: uiText.data.totalExcerptLabel,
      value: excerptText,
      hint: uiText.data.totalHint,
      color: theme.purple,
    },
  ];

  return (
    <DataCard
      accessible
      accessibilityLabel={`${uiText.data.readingRhythm}：${statement}` +
        `${uiText.data.currentStreak}${streakText}，${uiText.data.totalReadingDays}${daysText}，${uiText.data.totalExcerptLabel}${excerptText}`}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleLeft}>
          <SymbolView name="book" size={22} tintColor={theme.blue} weight="medium" />
          <Text style={[styles.title, { color: theme.blue }]}>{uiText.data.readingRhythm}</Text>
        </View>
        <Text style={[styles.showAll, { color: theme.blue }]}>{uiText.data.showAll}</Text>
      </View>

      <Text style={[styles.statement, { color: theme.primaryText }]}>{statement}</Text>

      <View style={[styles.divider, { backgroundColor: theme.divider }]} />

      <View style={styles.statsRow}>
        {columns.map((col, i) => (
          <View key={col.label} style={styles.statCol}>
            {i > 0 ? (
              <View style={[styles.vDivider, { backgroundColor: theme.divider }]} />
            ) : null}
            <View style={styles.statBody}>
              <Text style={[styles.statLabel, { color: theme.secondaryText }]}>
                {col.label}
              </Text>
              <Text
                style={[styles.statValue, { color: col.color }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {col.value}
              </Text>
              <Text style={[styles.statHint, { color: theme.secondaryText }]}>{col.hint}</Text>
            </View>
          </View>
        ))}
      </View>
    </DataCard>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    marginLeft: 8,
  },
  /** 纯装饰（详情页未实现，不可点）。 */
  showAll: {
    fontSize: 17,
    fontWeight: '700',
  },
  /** 加粗结论句。 */
  statement: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 27,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },
  statsRow: {
    flexDirection: 'row',
  },
  statCol: {
    flex: 1,
    flexDirection: 'row',
  },
  /** 列之间很淡的竖分隔线（第一列左侧不画）。 */
  vDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginRight: 12,
  },
  statBody: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  statHint: {
    fontSize: 14,
    marginTop: 8,
  },
});
