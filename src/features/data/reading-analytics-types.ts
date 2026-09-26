/**
 * Data Tab Core A: Reading Analytics public types.
 *
 * Units and nullability are part of the contract — read them before use:
 * - Durations are raw seconds (number), never formatted strings.
 * - Speeds are characters/minute (number), or null when there is no
 *   eligible data (null = "unknown", never 0).
 * - `dayKey` is a device-local `YYYY-MM-DD` (see local-day.ts), never UTC.
 */

/**
 * Per-day reading facts. `getDailyReadingStats` always returns one entry
 * per requested calendar day, zero-filled — a day with no reading still
 * appears with 0s and null speed.
 */
export type DailyReadingStats = {
  /** Device-local calendar day, `YYYY-MM-DD`. */
  dayKey: string;
  /** SUM(active_seconds) of valid sessions attributed to this day. */
  activeSeconds: number;
  /** SUM(forward_characters) of valid sessions attributed to this day. */
  forwardCharacters: number;
  /**
   * Weighted reading speed for this day:
   * SUM(eligible forwardCharacters) / SUM(eligible activeSeconds) * 60.
   * null when the day has no speed-eligible data.
   */
  readingSpeedCharsPerMinute: number | null;
  /**
   * Slowest / fastest single-session speed this day (chars/min), over the
   * same speed-eligible sessions as `readingSpeedCharsPerMinute`.
   * null when the day has no speed-eligible data. Drives the Health-style
   * range bars: min = bar bottom, max = bar top.
   */
  readingSpeedMinCharsPerMinute: number | null;
  readingSpeedMaxCharsPerMinute: number | null;
  /** Number of reader_excerpts created on this day. */
  excerptCount: number;
};

/**
 * Headline analytics. Built by `getReadingAnalyticsSummary()`; future
 * Data Tab screens consume this instead of querying SQLite directly.
 */
export type ReadingAnalyticsSummary = {
  /** SUM(active_seconds) of today's valid sessions (persisted values only). */
  todayActiveSeconds: number;
  /** Today + previous 6 local calendar days, SUM(active_seconds). */
  last7DaysActiveSeconds: number;
  /**
   * Yesterday + 6 days before (7 completed calendar days),
   * SUM(active_seconds) / 7. Calendar-day average, not active-day average.
   */
  previous7CompletedDaysAverageActiveSeconds: number;
  /** SUM(active_seconds) over all valid sessions. */
  totalActiveSeconds: number;
  /** Current reading streak in days (see computeCurrentStreakDays). */
  currentStreakDays: number;
  /** Distinct local calendar days with activeSeconds > 0, all history. */
  totalReadingDays: number;
  /** Weighted speed over the last 7 calendar days, null when no data. */
  last7DaysReadingSpeedCharsPerMinute: number | null;
  /** Weighted speed over all history, null when no data. */
  allTimeReadingSpeedCharsPerMinute: number | null;
  /** reader_excerpts created today (local day). */
  todayExcerptCount: number;
  /**
   * SUM(forward_characters) of today's valid sessions.
   * Read-only UI aggregation added for Data Tab Core B.3 ("今日阅读字数").
   * Same normalization and day attribution as todayActiveSeconds; no
   * runtime-tracking, session-recording, or schema changes.
   */
  todayForwardCharacters: number;
  /** All reader_excerpts rows (source of truth; deletions reflect here). */
  totalExcerptCount: number;
};

// ---------------------------------------------------------------------------
// Internal row shapes. The repository selects exactly these columns
// (never SELECT *); the pure layer normalizes them into day-keyed facts.
// ---------------------------------------------------------------------------

/** Narrow row from reader_reading_sessions for analytics. */
export type ReadingAnalyticsSessionRow = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  activeSeconds: number;
  forwardCharacters: number;
  /**
   * Event-time local day (YYYY-MM-DD), frozen when the session was created.
   * The primary day-attribution source; null only for pre-v16 legacy rows
   * that the backfill could not interpret.
   */
  localDayKey: string | null;
};

/** Narrow row from reader_excerpts for analytics. */
export type ReadingAnalyticsExcerptRow = {
  id: number;
  createdAt: string;
  /** Event-time local day (YYYY-MM-DD), frozen when the excerpt was created. */
  createdLocalDayKey: string | null;
};

/**
 * A session row validated and attributed to one device-local calendar day.
 * Sessions never cross a local day (ReadingSession Core splits at local
 * midnight), so attribution is by startedAt — no re-splitting here.
 */
export type NormalizedAnalyticsSession = {
  id: string;
  dayKey: string;
  activeSeconds: number;
  forwardCharacters: number;
};

/** An excerpt row validated and attributed to one device-local day. */
export type NormalizedAnalyticsExcerpt = {
  id: number;
  dayKey: string;
};
