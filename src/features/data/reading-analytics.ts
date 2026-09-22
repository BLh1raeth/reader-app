/**
 * Data Tab Core A: pure reading-analytics aggregation.
 *
 * This module is the ONLY place that defines analytics semantics
 * (day attribution, streak rules, speed eligibility, weighted formulas).
 * It is pure TypeScript: no React Native imports, no SQLite, no Date.now().
 * "Today" always arrives as an explicit `todayKey` / `now` parameter so the
 * math is deterministic and testable in Node.
 *
 * Layering:
 *   SQLite
 *     -> reading-analytics-repository.ts (narrow SELECTs)
 *     -> normalize*() here (validation + local-day attribution; invalid
 *        rows are skipped with a DEV warning, never silently fixed)
 *     -> buildDailyStats() / analyzeReadingData() here (pure aggregation)
 *     -> reading-analytics-service.ts (public async API)
 */

import {
  addLocalCalendarDays,
  compareLocalDayKeys,
  localDayRange,
  toLocalDayKey,
} from './local-day';
import type {
  DailyReadingStats,
  NormalizedAnalyticsExcerpt,
  NormalizedAnalyticsSession,
  ReadingAnalyticsExcerptRow,
  ReadingAnalyticsSessionRow,
  ReadingAnalyticsSummary,
} from './reading-analytics-types';

// RN global. Declared locally so this pure module also compiles standalone
// in Node (fixtures); at runtime inside the app it resolves to the real
// RN global, in Node it is undefined and devWarn() no-ops.
declare const __DEV__: boolean | undefined;

function devWarn(tag: string, details: Record<string, string | number>): void {
  // Guarded so this pure module also runs in Node (fixtures), where
  // the RN __DEV__ global does not exist.
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(tag, JSON.stringify(details));
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// Normalization: raw rows -> validated, day-keyed facts.
// ---------------------------------------------------------------------------

/**
 * Validate one session row and attribute it to a device-local day.
 * Returns null (row skipped) when the row is unusable. Cross-midnight
 * sessions violate the ReadingSession Core invariant (local-midnight
 * split); they are still attributed by startedAt but flagged in DEV so a
 * real occurrence gets noticed instead of silently re-split here.
 */
export function normalizeAnalyticsSession(
  row: ReadingAnalyticsSessionRow,
): NormalizedAnalyticsSession | null {
  const { id, startedAt, endedAt, activeSeconds, forwardCharacters } = row;
  if (typeof id !== 'string' || id.length === 0) {
    devWarn('[READING_ANALYTICS_INVALID_ROW]', { reason: 'bad-id', id: String(id) });
    return null;
  }
  const dayKey = toLocalDayKey(startedAt);
  if (dayKey === null) {
    devWarn('[READING_ANALYTICS_INVALID_ROW]', { reason: 'bad-started-at', id });
    return null;
  }
  if (!isFiniteNumber(activeSeconds) || activeSeconds < 0) {
    devWarn('[READING_ANALYTICS_INVALID_ROW]', { reason: 'bad-active-seconds', id });
    return null;
  }
  if (!isFiniteNumber(forwardCharacters) || forwardCharacters < 0) {
    devWarn('[READING_ANALYTICS_INVALID_ROW]', { reason: 'bad-forward-characters', id });
    return null;
  }
  if (endedAt !== null) {
    const endDayKey = toLocalDayKey(endedAt);
    if (endDayKey === null) {
      devWarn('[READING_ANALYTICS_INVALID_ROW]', { reason: 'bad-ended-at', id });
      return null;
    }
    if (endDayKey !== dayKey) {
      // Invariant violation: the tracker splits at local midnight, so a
      // persisted session should never span two local days. Attribute by
      // startedAt (the tracker's own convention) and surface it in DEV.
      devWarn('[READING_ANALYTICS_CROSS_MIDNIGHT]', { id });
    }
  }
  return { id, dayKey, activeSeconds, forwardCharacters };
}

/** Validate one excerpt row and attribute it to a device-local day. */
export function normalizeAnalyticsExcerpt(
  row: ReadingAnalyticsExcerptRow,
): NormalizedAnalyticsExcerpt | null {
  const { id, createdAt } = row;
  if (!isFiniteNumber(id)) {
    devWarn('[READING_ANALYTICS_INVALID_EXCERPT]', { reason: 'bad-id' });
    return null;
  }
  const dayKey = toLocalDayKey(createdAt);
  if (dayKey === null) {
    devWarn('[READING_ANALYTICS_INVALID_EXCERPT]', { reason: 'bad-created-at', id });
    return null;
  }
  return { id, dayKey };
}

// ---------------------------------------------------------------------------
// Reading speed: eligibility + weighted aggregate.
// ---------------------------------------------------------------------------

/**
 * Speed eligibility, first version: deliberately threshold-free.
 * A session contributes to speed only when it has both real active time
 * AND real forward progress. A 20s open-and-stare still counts toward
 * reading time, but not toward reading speed.
 */
export function isSpeedEligibleSession(session: {
  activeSeconds: number;
  forwardCharacters: number;
}): boolean {
  return session.activeSeconds > 0 && session.forwardCharacters > 0;
}

/**
 * Weighted characters/minute over a set of sessions:
 * SUM(chars) / SUM(seconds) * 60. A 30s session never weighs the same as
 * a 30min one. Returns null (not 0) when there is no eligible data —
 * null means "unknown", 0 would mean "reads at zero speed".
 */
export function weightedSpeedCharsPerMinute(
  sessions: ReadonlyArray<{ activeSeconds: number; forwardCharacters: number }>,
): number | null {
  let eligibleSeconds = 0;
  let eligibleCharacters = 0;
  for (const session of sessions) {
    if (!isSpeedEligibleSession(session)) continue;
    eligibleSeconds += session.activeSeconds;
    eligibleCharacters += session.forwardCharacters;
  }
  if (eligibleSeconds <= 0) return null;
  return (eligibleCharacters / eligibleSeconds) * 60;
}

// ---------------------------------------------------------------------------
// Daily series (zero-filled).
// ---------------------------------------------------------------------------

/**
 * One DailyReadingStats per local calendar day in [startDay, endDay],
 * both inclusive. Days with no data appear as zeros with null speed, so
 * future charts never see a misaligned date axis.
 */
export function buildDailyStats(
  sessions: ReadonlyArray<NormalizedAnalyticsSession>,
  excerpts: ReadonlyArray<NormalizedAnalyticsExcerpt>,
  startDay: string,
  endDay: string,
): DailyReadingStats[] {
  const days = localDayRange(startDay, endDay);
  const statsByDay = new Map<string, DailyReadingStats>();
  for (const dayKey of days) {
    statsByDay.set(dayKey, {
      dayKey,
      activeSeconds: 0,
      forwardCharacters: 0,
      readingSpeedCharsPerMinute: null,
      excerptCount: 0,
    });
  }
  const sessionsByDay = new Map<string, NormalizedAnalyticsSession[]>();
  for (const session of sessions) {
    const bucket = statsByDay.get(session.dayKey);
    if (!bucket) continue; // outside the requested window
    bucket.activeSeconds += session.activeSeconds;
    bucket.forwardCharacters += session.forwardCharacters;
    let list = sessionsByDay.get(session.dayKey);
    if (!list) {
      list = [];
      sessionsByDay.set(session.dayKey, list);
    }
    list.push(session);
  }
  for (const excerpt of excerpts) {
    const bucket = statsByDay.get(excerpt.dayKey);
    if (!bucket) continue;
    bucket.excerptCount += 1;
  }
  for (const dayKey of days) {
    const bucket = statsByDay.get(dayKey);
    if (!bucket) continue;
    bucket.readingSpeedCharsPerMinute = weightedSpeedCharsPerMinute(
      sessionsByDay.get(dayKey) ?? [],
    );
  }
  return days.map((dayKey) => {
    const bucket = statsByDay.get(dayKey);
    if (!bucket) throw new Error(`Missing daily bucket for ${dayKey}`);
    return bucket;
  });
}

// ---------------------------------------------------------------------------
// Reading days + streak.
// ---------------------------------------------------------------------------

/**
 * Reading-day definition, v1: a local calendar day with aggregate
 * activeSeconds > 0 is a reading day. No minute thresholds — those belong
 * to a future goals system, not to Core A.
 */
export function computeReadingDayKeys(
  sessions: ReadonlyArray<NormalizedAnalyticsSession>,
): Set<string> {
  const secondsByDay = new Map<string, number>();
  for (const session of sessions) {
    secondsByDay.set(
      session.dayKey,
      (secondsByDay.get(session.dayKey) ?? 0) + session.activeSeconds,
    );
  }
  const readingDays = new Set<string>();
  for (const [dayKey, seconds] of secondsByDay) {
    if (seconds > 0) readingDays.add(dayKey);
  }
  return readingDays;
}

/**
 * Current streak, in days.
 *
 * - referenceDay = today if today is a reading day; otherwise yesterday
 *   if yesterday is a reading day; otherwise the streak is 0. (A quiet
 *   morning must not zero out a 20-day streak before the user opens the
 *   reader.)
 * - From the reference day, walk backward while each day is a reading day.
 */
export function computeCurrentStreakDays(
  readingDayKeys: ReadonlySet<string>,
  todayKey: string,
): number {
  let referenceDay: string | null = null;
  if (readingDayKeys.has(todayKey)) {
    referenceDay = todayKey;
  } else {
    const yesterdayKey = addLocalCalendarDays(todayKey, -1);
    if (readingDayKeys.has(yesterdayKey)) referenceDay = yesterdayKey;
  }
  if (referenceDay === null) return 0;
  let streak = 0;
  let cursor = referenceDay;
  while (readingDayKeys.has(cursor)) {
    streak += 1;
    cursor = addLocalCalendarDays(cursor, -1);
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

function sumActiveSeconds(
  sessions: ReadonlyArray<NormalizedAnalyticsSession>,
  fromDay: string,
  toDay: string,
): number {
  let total = 0;
  for (const session of sessions) {
    if (
      compareLocalDayKeys(session.dayKey, fromDay) >= 0 &&
      compareLocalDayKeys(session.dayKey, toDay) <= 0
    ) {
      total += session.activeSeconds;
    }
  }
  return total;
}

/**
 * Headline analytics over normalized sessions + excerpts.
 * `todayKey` is the device-local day; every window below derives from it.
 */
export function analyzeReadingData(
  sessions: ReadonlyArray<NormalizedAnalyticsSession>,
  excerpts: ReadonlyArray<NormalizedAnalyticsExcerpt>,
  todayKey: string,
): ReadingAnalyticsSummary {
  const last7Start = addLocalCalendarDays(todayKey, -6);
  const previous7Start = addLocalCalendarDays(todayKey, -7);
  const previous7End = addLocalCalendarDays(todayKey, -1);

  const todayActiveSeconds = sumActiveSeconds(sessions, todayKey, todayKey);
  const last7DaysActiveSeconds = sumActiveSeconds(sessions, last7Start, todayKey);
  const previous7CompletedDaysAverageActiveSeconds =
    sumActiveSeconds(sessions, previous7Start, previous7End) / 7;

  let totalActiveSeconds = 0;
  for (const session of sessions) totalActiveSeconds += session.activeSeconds;

  const readingDayKeys = computeReadingDayKeys(sessions);

  const last7Sessions = sessions.filter(
    (session) =>
      compareLocalDayKeys(session.dayKey, last7Start) >= 0 &&
      compareLocalDayKeys(session.dayKey, todayKey) <= 0,
  );

  let todayExcerptCount = 0;
  for (const excerpt of excerpts) {
    if (excerpt.dayKey === todayKey) todayExcerptCount += 1;
  }

  return {
    todayActiveSeconds,
    last7DaysActiveSeconds,
    previous7CompletedDaysAverageActiveSeconds,
    totalActiveSeconds,
    currentStreakDays: computeCurrentStreakDays(readingDayKeys, todayKey),
    totalReadingDays: readingDayKeys.size,
    last7DaysReadingSpeedCharsPerMinute: weightedSpeedCharsPerMinute(last7Sessions),
    allTimeReadingSpeedCharsPerMinute: weightedSpeedCharsPerMinute(sessions),
    todayExcerptCount,
    totalExcerptCount: excerpts.length,
  };
}
