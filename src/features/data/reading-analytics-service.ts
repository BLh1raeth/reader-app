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

import { isValidDayKey, todayLocalDayKey } from '../../shared/time/local-day';
import { readingAnalyticsRepository } from './reading-analytics-repository';
import {
  analyzeReadingData,
  bucketActiveSecondsByLocalHour,
  buildDailyStats,
  normalizeAnalyticsExcerpt,
  normalizeAnalyticsSession,
  normalizeSpeedSample,
} from './reading-analytics';
import type {
  DailyReadingStats,
  NormalizedAnalyticsExcerpt,
  NormalizedAnalyticsSession,
  NormalizedSpeedSample,
  ReadingAnalyticsSummary,
} from './reading-analytics-types';

async function loadNormalizedData(): Promise<{
  sessions: NormalizedAnalyticsSession[];
  excerpts: NormalizedAnalyticsExcerpt[];
  samples: NormalizedSpeedSample[];
}> {
  const [sessionRows, excerptRows, sampleRows] = await Promise.all([
    readingAnalyticsRepository.listSessionsForAnalytics(),
    readingAnalyticsRepository.listExcerptsForAnalytics(),
    readingAnalyticsRepository.listSpeedSamplesForAnalytics(),
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
  const samples: NormalizedSpeedSample[] = [];
  for (const row of sampleRows) {
    const normalized = normalizeSpeedSample(row);
    if (normalized) samples.push(normalized);
  }
  return { sessions, excerpts, samples };
}

/**
 * Headline reading analytics for the device-local "today".
 * Pass `now` only to pin "today" (tests / previews); production callers
 * omit it and get the real device-local day.
 */
export async function getReadingAnalyticsSummary(
  now: Date = new Date(),
): Promise<ReadingAnalyticsSummary> {
  const { sessions, excerpts, samples } = await loadNormalizedData();
  return analyzeReadingData(sessions, excerpts, samples, todayLocalDayKey(now));
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
  const { sessions, excerpts, samples } = await loadNormalizedData();
  return buildDailyStats(sessions, excerpts, samples, startDay, endDay);
}

/**
 * Today's active seconds bucketed into 24 device-local hours [0..23].
 * Zero-filled; sums to `getReadingAnalyticsSummary().todayActiveSeconds`
 * for the same day (same validation, same session set).
 * Pass `now` only to pin "today" (tests / previews); production callers
 * omit it and get the real device-local day.
 */
export async function getTodayHourlyActiveSeconds(
  now: Date = new Date(),
): Promise<number[]> {
  const rows = await readingAnalyticsRepository.listSessionsForAnalytics();
  return bucketActiveSecondsByLocalHour(rows, todayLocalDayKey(now), now.getTime());
}
