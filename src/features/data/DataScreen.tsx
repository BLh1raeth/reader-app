import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../design-system/tokens';
import { uiText } from '../../localization';
import { addLocalCalendarDays, todayLocalDayKey } from '../../shared/time/local-day';
import { AnalyticsSummarySection } from './AnalyticsSummarySection';
import { ReadingTimeHero } from './ReadingTimeHero';
import { SevenDayReadingChart } from './SevenDayReadingChart';
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

/**
 * Data Tab Core B：数据首页。
 *
 * 只消费 Reading Analytics public API（getReadingAnalyticsSummary /
 * getDailyReadingStats），不直接读取 reader_reading_sessions / reader_excerpts，
 * 不写 SQL。最近 7 天 = 今天 + 前 6 个 local calendar day。
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

  if (data === null && !loadFailed) {
    // 本地 SQLite 查询通常几十毫秒：宁可短暂空白，不闪 spinner（与 Excerpts 一致）。
    return <View style={styles.screen} />;
  }

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

        {loadFailed && data === null ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{uiText.data.loadFailed}</Text>
          </View>
        ) : (
          data && (
            <>
              <View style={styles.heroBlock}>
                <ReadingTimeHero
                  todayActiveSeconds={data.summary.todayActiveSeconds}
                  baselineActiveSeconds={
                    data.summary.previous7CompletedDaysAverageActiveSeconds
                  }
                />
              </View>
              <View style={styles.card}>
                <SevenDayReadingChart
                  days={data.last7Days}
                  todayKey={data.todayKey}
                  last7DaysActiveSeconds={data.summary.last7DaysActiveSeconds}
                />
              </View>
              <AnalyticsSummarySection summary={data.summary} />
            </>
          )
        )}
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
    marginBottom: 24,
  },
  /** 趋势容器：普通圆角实体卡片，非 Liquid Glass。 */
  card: {
    backgroundColor: tokens.colors.groupedCell,
    borderRadius: 26,
    padding: 16,
    marginBottom: 24,
  },
  errorBox: {
    paddingVertical: 24,
  },
  errorText: {
    color: tokens.colors.secondaryLabel,
    fontSize: 14,
    textAlign: 'center',
  },
});
