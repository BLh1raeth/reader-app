import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import { addLocalCalendarDays, todayLocalDayKey } from '../../shared/time/local-day';
import { TodayReadingCard } from './cards/TodayReadingCard';
import { Last7DaysCard } from './cards/Last7DaysCard';
import { ReadingActivityCard } from './cards/ReadingActivityCard';
import { ReadingSpeedCard } from './cards/ReadingSpeedCard';
import {
  ExcerptCountCard,
  ReadingDaysCard,
  ReadingStreakCard,
} from './cards/NumberCards';
import {
  getDailyReadingStats,
  getReadingAnalyticsSummary,
} from './reading-analytics-service';
import type {
  DailyReadingStats,
  ReadingAnalyticsSummary,
} from './reading-analytics-types';

type DataLoadResult = {
  summary: ReadingAnalyticsSummary;
  last7Days: DailyReadingStats[];
  todayKey: string;
};

const CARD_GAP = 14;
const SECTION_SPACING = 24;

/**
 * Data Tab Core B.1：Apple Health 式 Card Dashboard。
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
  const [data, setData] = useState<DataLoadResult | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadingRef = useRef(false);

  const loadData = useCallback(async () => {
    // 避免 focus 与并发回调造成重叠请求：简单守卫即可，本地 SQLite 很快。
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const todayKey = todayLocalDayKey();
      const startDay = addLocalCalendarDays(todayKey, -6);
      const [summary, last7Days] = await Promise.all([
        getReadingAnalyticsSummary(),
        getDailyReadingStats({ startDay, endDay: todayKey }),
      ]);
      setData({ summary, last7Days, todayKey });
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

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 2, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={styles.largeTitle}>
          {uiText.data.title}
        </Text>

        <View style={styles.heroBlock}>
          <TodayReadingCard
            todayActiveSeconds={summary?.todayActiveSeconds ?? null}
            baselineActiveSeconds={
              summary?.previous7CompletedDaysAverageActiveSeconds ?? null
            }
          />
        </View>

        {loadFailed ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{uiText.data.loadFailed}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{uiText.data.recentReading}</Text>
        <View style={styles.cardRow}>
          <View style={styles.cardCell}>
            <Last7DaysCard
              days={last7Days}
              todayKey={todayKey}
              last7DaysActiveSeconds={summary?.last7DaysActiveSeconds ?? null}
            />
          </View>
          <View style={styles.cardCell}>
            <ReadingActivityCard days={last7Days} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>{uiText.data.readingHabits}</Text>
        <View style={styles.cardRow}>
          <View style={styles.cardCell}>
            <ReadingStreakCard streakDays={summary?.currentStreakDays ?? null} />
          </View>
          <View style={styles.cardCell}>
            <ReadingSpeedCard
              speed={summary?.last7DaysReadingSpeedCharsPerMinute ?? null}
              days={last7Days}
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>{uiText.data.readingAccumulation}</Text>
        <View style={styles.cardRow}>
          <View style={styles.cardCell}>
            <ReadingDaysCard totalDays={summary?.totalReadingDays ?? null} />
          </View>
          <View style={styles.cardCell}>
            <ExcerptCountCard excerptCount={summary?.totalExcerptCount ?? null} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.colors.groupedBackground,
  },
  content: {
    paddingHorizontal: 20,
  },
  largeTitle: {
    color: tokens.colors.label,
    fontSize: tokens.typography.largeTitle,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 40,
    marginBottom: 20,
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
  sectionTitle: {
    color: tokens.colors.label,
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  /** 两列等宽 grid：同一 row 卡片 stretch 等高；minHeight 在各卡内部按需。 */
  cardRow: {
    flexDirection: 'row',
    gap: CARD_GAP,
    marginBottom: SECTION_SPACING,
  },
  cardCell: {
    flex: 1,
  },
});
