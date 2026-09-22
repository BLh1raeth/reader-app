/**
 * Data Tab Core A: public Reading Analytics API.
 *
 * This is the only entry point future Data UI should use:
 *
 *   const summary = await getReadingAnalyticsSummary();
 *   const last7Days = await getDailyReadingStats({
 *     startDay: '2026-09-17',
 *     endDay: '2026-09-23',
 *   });
 *
 * The UI never needs to know table names, session row shapes, streak
 * rules or speed eligibility — those are centralized in
 * reading-analytics.ts (pure) and local-day.ts.
 */

import { isValidDayKey, todayLocalDayKey } from './local-day';
import { readingAnalyticsRepository } from './reading-analytics-repository';
import {
  analyzeReadingData,
  buildDailyStats,
  normalizeAnalyticsExcerpt,
  normalizeAnalyticsSession,
} from './reading-analytics';
import type {
  DailyReadingStats,
  NormalizedAnalyticsExcerpt,
  NormalizedAnalyticsSession,
  ReadingAnalyticsSummary,
} from './reading-analytics-types';

async function loadNormalizedData(): Promise<{
  sessions: NormalizedAnalyticsSession[];
  excerpts: NormalizedAnalyticsExcerpt[];
}> {
  const [sessionRows, excerptRows] = await Promise.all([
    readingAnalyticsRepository.listSessionsForAnalytics(),
    readingAnalyticsRepository.listExcerptsForAnalytics(),
  ]);
  const sessions: NormalizedAnalyticsSession[] = [];
  for (const row of sessionRows) {
    const normalized = normalizeAnalyticsSession(row);
    if (normalized) sessions.push(normalized);
  }
  const excerpts: NormalizedAnalyticsExcerpt[] = [];
  for (const row of excerptRows) {
    const normalized = normalizeAnalyticsExcerpt(row);
    if (normalized) excerpts.push(normalized);
  }
  return { sessions, excerpts };
}

/**
 * Headline reading analytics for the device-local "today".
 * Pass `now` only to pin "today" (tests / previews); production callers
 * omit it and get the real device-local day.
 */
export async function getReadingAnalyticsSummary(
  now: Date = new Date(),
): Promise<ReadingAnalyticsSummary> {
  const { sessions, excerpts } = await loadNormalizedData();
  return analyzeReadingData(sessions, excerpts, todayLocalDayKey(now));
}

export type DailyReadingStatsRange = {
  /** Device-local day key, inclusive. */
  startDay: string;
  /** Device-local day key, inclusive. */
  endDay: string;
};

/**
 * Zero-filled per-day stats for [startDay, endDay] (both inclusive).
 * Always returns exactly one bucket per calendar day in the range.
 */
export async function getDailyReadingStats(
  range: DailyReadingStatsRange,
): Promise<DailyReadingStats[]> {
  const { startDay, endDay } = range;
  if (!isValidDayKey(startDay)) {
    throw new Error(`Invalid startDay (expected local YYYY-MM-DD): ${startDay}`);
  }
  if (!isValidDayKey(endDay)) {
    throw new Error(`Invalid endDay (expected local YYYY-MM-DD): ${endDay}`);
  }
  const { sessions, excerpts } = await loadNormalizedData();
  return buildDailyStats(sessions, excerpts, startDay, endDay);
}
