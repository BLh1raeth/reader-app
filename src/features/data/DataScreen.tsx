import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import { addLocalCalendarDays, todayLocalDayKey } from '../../shared/time/local-day';
import { useDataTheme } from './dataTheme';
import { USE_DEMO_DATA, buildDemoData } from './demo-data';
import { TodayReadingCard } from './cards/TodayReadingCard';
import { ReadingTimeCard } from './cards/ReadingTimeCard';
import { ReadingSpeedCard } from './cards/ReadingSpeedCard';
import { AccumulationCard } from './cards/AccumulationCard';
import {
  getDailyReadingStats,
  getReadingAnalyticsSummary,
  getTodayHourlyActiveSeconds,
} from './reading-analytics-service';
import type {
  DailyReadingStats,
  ReadingAnalyticsSummary,
} from './reading-analytics-types';

type DataLoadResult = {
  summary: ReadingAnalyticsSummary;
  last7Days: DailyReadingStats[];
  todayKey: string;
  /** 今天 24 小时 activeSeconds 分桶（0..23，零填充）。 */
  hourlyActiveSeconds: number[];
};

const CARD_GAP = 12;
const SECTION_SPACING = 24;

/**
 * Data Tab（B.6 黑白极简视觉：#FAFAFC 底 / 白圆角卡 / 黑灰文字与图表）。
 *
 *   数据（大标题）
 *   → “今日阅读” section 标题 + 主卡（灰阶指标行 + 三同心圆环）
 *   → “最近 7 天” section → 阅读时长 / 阅读速度（两张半宽卡）
 *   → 阅读节奏卡（结论 + 灰阶累计；“全部显示”在卡片内部右上，纯装饰）
 *
 * 只消费 Reading Analytics public API（getReadingAnalyticsSummary /
 * getDailyReadingStats），不直接读取 reader_reading_sessions / reader_excerpts，
 * 不写 SQL，不重算统计口径。最近 7 天 = 今天 + 前 6 个 local calendar day。
 *
 * Tab focus 时重新加载（Reader 新 session / 新增或删除摘录后返回即刷新）。
 * useFocusEffect 在初次挂载时也会执行，覆盖首屏加载，不与 mount 重复请求。
 */
export default function DataScreen() {
  const insets = useSafeAreaInsets();
  const theme = useDataTheme();
  const [data, setData] = useState<DataLoadResult | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadingRef = useRef(false);

  const loadData = useCallback(async () => {
    // 避免 focus 与并发回调造成重叠请求：简单守卫即可，本地 SQLite 很快。
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const todayKey = todayLocalDayKey();
      if (USE_DEMO_DATA) {
        // UI 预览模式：显示 demo-data.ts 的假数据，不读 SQLite。
        // 恢复真实数据：把 USE_DEMO_DATA 改成 false。
        if (__DEV__) {
          console.warn('[DATA_DEMO_MODE] showing fake preview data');
        }
        const demo = buildDemoData(todayKey);
        setData({
          summary: demo.summary,
          last7Days: demo.last7Days,
          todayKey: demo.todayKey,
          hourlyActiveSeconds: demo.hourlyActiveSeconds,
        });
        setLoadFailed(false);
        return;
      }
      const startDay = addLocalCalendarDays(todayKey, -6);
      const [summary, last7Days, hourlyActiveSeconds] = await Promise.all([
        getReadingAnalyticsSummary(),
        getDailyReadingStats({ startDay, endDay: todayKey }),
        getTodayHourlyActiveSeconds(),
      ]);
      setData({ summary, last7Days, todayKey, hourlyActiveSeconds });
      setLoadFailed(false);
    } catch (error) {
      if (__DEV__) {
        console.warn('[READING_ANALYTICS_LOAD_FAILED]');
      }
      setLoadFailed(true);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData]),
  );

  const summary = data?.summary ?? null;
  const last7Days = data?.last7Days ?? null;
  const todayKey = data?.todayKey ?? '';
  const activeDays7 =
    last7Days === null ? null : last7Days.filter((d) => d.activeSeconds > 0).length;

  return (
    <View style={[styles.screen, { backgroundColor: theme.pageBackground }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          // 底部留出悬浮 Tab Bar 的高度，保证阅读节奏卡能完整滚到可视区。
          { paddingTop: insets.top + 2, paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={[styles.largeTitle, { color: theme.primaryText }]}>
          {uiText.data.title}
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>
          {uiText.data.todayReadingTitle}
        </Text>
        <View style={styles.heroBlock}>
          <TodayReadingCard
            activeSeconds={summary?.todayActiveSeconds ?? null}
            forwardCharacters={summary?.todayForwardCharacters ?? null}
            excerptCount={summary?.todayExcerptCount ?? null}
            activeDays7={activeDays7}
          />
        </View>

        {loadFailed ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{uiText.data.loadFailed}</Text>
          </View>
        ) : null}

        <View style={styles.cardRow}>
          <View style={styles.cardCell}>
            <ReadingTimeCard
              hourlyActiveSeconds={data?.hourlyActiveSeconds ?? null}
              style={styles.halfCard}
            />
          </View>
          <View style={styles.cardCell}>
            <ReadingSpeedCard
              latestSpeedSample={summary?.latestSpeedSample ?? null}
              days={last7Days}
              style={styles.halfCard}
            />
          </View>
        </View>

        <AccumulationCard
          days={last7Days}
          todayKey={todayKey}
          last7DaysActiveSeconds={summary?.last7DaysActiveSeconds ?? null}
          streakDays={summary?.currentStreakDays ?? null}
          totalDays={summary?.totalReadingDays ?? null}
          excerptCount={summary?.totalExcerptCount ?? null}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
  },
  /** B.6：34pt / 800。位置（insets.top + 2 / 左 20）与其他两页统一，不动。 */
  largeTitle: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 40,
    marginBottom: 16,
  },
  heroBlock: {
    marginBottom: SECTION_SPACING,
  },
  errorBox: {
    marginBottom: SECTION_SPACING,
  },
  errorText: {
    color: tokens.colors.secondaryLabel,
    fontSize: 14,
    textAlign: 'center',
  },
  /** section 小标题：21pt / 800，与上下卡片留白。 */
  sectionTitle: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 12,
  },
  /** 两列等宽：同一 row 卡片 stretch 等高。 */
  cardRow: {
    flexDirection: 'row',
    gap: CARD_GAP,
    marginBottom: SECTION_SPACING,
  },
  cardCell: {
    flex: 1,
  },
  /** B.6：半宽卡内边距 20（规范 18–20）；flex:1 撑满 cell，与同行卡等高。 */
  halfCard: {
    padding: 20,
    flex: 1,
  },
});
