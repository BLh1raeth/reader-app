/**
 * Data Tab Core A: Reading Analytics repository.
 *
 * Read-only consumer of ReadingSession Core data. Responsibilities:
 * - SELECT exactly the columns analytics needs (never SELECT *).
 * - Return raw rows; validation, local-day attribution and every
 *   aggregation rule live in reading-analytics.ts (pure layer).
 *
 * This repository never writes, never recovers stale sessions, never
 * re-times open sessions: it reports the persisted active_seconds as-is.
 * Stale recovery belongs to ReadingSession Core (bootstrap), not here.
 */

import { getLibraryDatabase } from '../library/library-database';
import type {
  ReadingAnalyticsExcerptRow,
  ReadingAnalyticsSessionRow,
} from './reading-analytics-types';

type SessionColumns = {
  id: string;
  started_at: string;
  ended_at: string | null;
  active_seconds: number;
  forward_characters: number;
  local_day_key: string | null;
};

type ExcerptColumns = {
  id: number;
  created_at: string;
  created_local_day_key: string | null;
};

export const readingAnalyticsRepository = {
  /**
   * All sessions, oldest first, with only the analytics-relevant columns.
   * Personal-app data volume makes a full scan fine; per-day aggregation
   * happens in TypeScript (local timezone/DST are safer there than in SQL).
   * Open sessions (ended_at NULL) are included with their persisted
   * active_seconds — analytics never infers extra wall-clock time.
   */
  async listSessionsForAnalytics(): Promise<ReadingAnalyticsSessionRow[]> {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<SessionColumns>(
      `SELECT id, started_at, ended_at, active_seconds, forward_characters,
              local_day_key
       FROM reader_reading_sessions
       ORDER BY started_at ASC;`,
    );
    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      activeSeconds: row.active_seconds,
      forwardCharacters: row.forward_characters,
      localDayKey: row.local_day_key,
    }));
  },

  /**
   * All excerpts with only the analytics-relevant columns. Rows are the
   * source of truth: a deleted excerpt simply stops appearing here, so
   * totals naturally decrease. No duplicated counters anywhere.
   */
  async listExcerptsForAnalytics(): Promise<ReadingAnalyticsExcerptRow[]> {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<ExcerptColumns>(
      'SELECT id, created_at, created_local_day_key FROM reader_excerpts;',
    );
    return rows.map((row) => ({ id: row.id, createdAt: row.created_at, createdLocalDayKey: row.created_local_day_key }));
  },
};
