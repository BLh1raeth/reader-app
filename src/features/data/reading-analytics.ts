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
  isValidDayKey,
  localDayRange,
  toLocalDayKey,
} from '../../shared/time/local-day';
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

/**
 * Day attribution for one event row.
 *
 * Normal path (v16+): use the persisted event-time local day key — it was
 * frozen when the event happened and never moves with later timezone
 * changes. The key is still format-validated; the database is not trusted
 * blindly.
 *
 * Abnormal path: a missing/invalid key (pre-v16 legacy row the backfill
 * could not interpret). Fall back to interpreting the timestamp in the
 * CURRENT device timezone so history stats are not silently lost, and
 * surface it in DEV. This is exception compatibility, never normal logic.
 */
function resolvePersistedDayKey(
  persistedDayKey: string | null,
  timestamp: string,
  rowType: 'session' | 'excerpt',
  rowId: string | number,
): string | null {
  if (typeof persistedDayKey === 'string' && isValidDayKey(persistedDayKey)) {
    return persistedDayKey;
  }
  devWarn('[READING_ANALYTICS_LOCAL_DAY_FALLBACK]', {
    rowType,
    id: String(rowId),
  });
  return toLocalDayKey(timestamp);
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
  const { id, startedAt, endedAt, activeSeconds, forwardCharacters, localDayKey } = row;
  if (typeof id !== 'string' || id.length === 0) {
    devWarn('[READING_ANALYTICS_INVALID_ROW]', { reason: 'bad-id', id: String(id) });
    return null;
  }
  // Prefer the persisted event-time local day; fall back to interpreting
  // startedAt in the current timezone only when the key is missing/invalid.
  const dayKey = resolvePersistedDayKey(localDayKey, startedAt, 'session', id);
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
  const { id, createdAt, createdLocalDayKey } = row;
  if (!isFiniteNumber(id)) {
    devWarn('[READING_ANALYTICS_INVALID_EXCERPT]', { reason: 'bad-id' });
    return null;
  }
  const dayKey = resolvePersistedDayKey(createdLocalDayKey, createdAt, 'excerpt', id);
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
 * Minimum active seconds for a session to count toward reading speed.
 * Physical lower bound of genuine reading: at a brisk 600 chars/min, one
 * phone page (~350 chars) takes ~35s to actually read. Anything much
 * shorter carrying hundreds of characters is page-flipping to find
 * something, not reading — without this floor a 4s/1500-char skim
 * reports 22500 chars/min and blows up the daily chart.
 */
export const MIN_SPEED_ELIGIBLE_SECONDS = 30;

/**
 * Speed eligibility: a session contributes to speed only when it has real
 * active time AND real forward progress AND enough duration to plausibly
 * be reading rather than flipping. A 20s open-and-stare still counts
 * toward reading time, but not toward reading speed; neither does a
 * sub-threshold skim.
 */
export function isSpeedEligibleSession(session: {
  activeSeconds: number;
  forwardCharacters: number;
}): boolean {
  return (
    session.activeSeconds >= MIN_SPEED_ELIGIBLE_SECONDS &&
    session.forwardCharacters > 0
  );
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

/**
 * Min/max single-session speed for a set of sessions (chars/min), over the
 * same speed-eligible sessions used by `weightedSpeedCharsPerMinute`.
 * Returns null when no session is speed-eligible — the day's range bar is
 * then omitted, not drawn as zero.
 */
export function daySpeedRangeCharsPerMinute(
  sessions: ReadonlyArray<{ activeSeconds: number; forwardCharacters: number }>,
): { min: number; max: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const session of sessions) {
    if (!isSpeedEligibleSession(session)) continue;
    const speed = (session.forwardCharacters / session.activeSeconds) * 60;
    if (min === null || speed < min) min = speed;
    if (max === null || speed > max) max = speed;
  }
  return min === null || max === null ? null : { min, max };
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
      readingSpeedMinCharsPerMinute: null,
      readingSpeedMaxCharsPerMinute: null,
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
    const daySessions = sessionsByDay.get(dayKey) ?? [];
    bucket.readingSpeedCharsPerMinute = weightedSpeedCharsPerMinute(daySessions);
    const range = daySpeedRangeCharsPerMinute(daySessions);
    bucket.readingSpeedMinCharsPerMinute = range?.min ?? null;
    bucket.readingSpeedMaxCharsPerMinute = range?.max ?? null;
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
 * Today's reading activity split into 24 device-local hour buckets [0..23].
 *
 * Each valid session's activeSeconds are distributed across the local hours
 * it overlaps, proportional to wall-clock overlap (a 10:20–11:10 session
 * contributes 40/50 of its seconds to hour 10 and 10/50 to hour 11).
 * Sessions never cross a local day (the tracker splits at local midnight),
 * so each session belongs to exactly one day. Rows that fail validation are
 * skipped exactly like everywhere else, so the 24 buckets always sum to the
 * day's activeSeconds total.
 *
 * Pure: `nowMs` pins "now" for still-open (endedAt === null) sessions.
 */
export function bucketActiveSecondsByLocalHour(
  rows: ReadonlyArray<ReadingAnalyticsSessionRow>,
  todayKey: string,
  nowMs: number,
): number[] {
  const buckets = new Array<number>(24).fill(0);
  for (const row of rows) {
    const session = normalizeAnalyticsSession(row);
    if (session === null || session.dayKey !== todayKey) continue;
    if (session.activeSeconds <= 0) continue;
    const startMs = Date.parse(row.startedAt);
    if (!Number.isFinite(startMs)) continue;
    const endMs = row.endedAt === null ? nowMs : Date.parse(row.endedAt);
    if (!Number.isFinite(endMs)) continue;
    const clampedEnd = Math.max(endMs, startMs);
    const wallMs = clampedEnd - startMs;
    if (wallMs <= 0) {
      buckets[new Date(startMs).getHours()] += session.activeSeconds;
      continue;
    }
    let cursor = startMs;
    while (cursor < clampedEnd) {
      const cursorDate = new Date(cursor);
      const hour = cursorDate.getHours();
      const hourStart = new Date(
        cursorDate.getFullYear(),
        cursorDate.getMonth(),
        cursorDate.getDate(),
        hour,
      ).getTime();
      const segmentEnd = Math.min(hourStart + 3_600_000, clampedEnd);
      buckets[hour] += (session.activeSeconds * (segmentEnd - cursor)) / wallMs;
      cursor = segmentEnd;
    }
  }
  return buckets;
}

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
 * SUM(forward_characters) over [fromDay, toDay] (both inclusive).
 * Same day-range convention as sumActiveSeconds; read-only aggregation
 * for the Data Tab "今日阅读字数" hero card (Core B.3).
 */
function sumForwardCharacters(
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
      total += session.forwardCharacters;
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
  const todayForwardCharacters = sumForwardCharacters(sessions, todayKey, todayKey);
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
    todayForwardCharacters,
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
