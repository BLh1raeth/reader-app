/**
 * Data Core A.1: one-time legacy local-day backfill.
 *
 * v15 and earlier rows did not store event-time timezone/local day.
 * Legacy backfill freezes the device's current local interpretation at
 * migration time. The original event timezone cannot be reconstructed.
 *
 * This module does the SQL work but never imports expo-sqlite: it runs
 * against a minimal structural interface so the migration transaction can
 * be passed in production and a recording mock in Node fixtures.
 */

import { planLocalDayBackfill } from '../../shared/time/local-day';

/** Minimal surface of the expo-sqlite transaction this backfill needs. */
export type LocalDayBackfillDatabase = {
  getAllAsync<T>(sql: string): Promise<T[]>;
  runAsync(sql: string, params: Array<string | number>): Promise<unknown>;
};

export type LocalDayBackfillResult = {
  sessionsBackfilled: number;
  excerptsBackfilled: number;
};

/**
 * Freeze local day keys for legacy rows. Idempotent by construction:
 * only rows with NULL/empty keys are selected, so rows that already have
 * a key are never touched and re-running changes nothing. Rows whose
 * timestamp cannot be parsed stay NULL — the backfill never invents a day
 * (Analytics treats them as invalid via its fallback path).
 */
export async function backfillLocalDayKeys(
  database: LocalDayBackfillDatabase,
): Promise<LocalDayBackfillResult> {
  const legacySessions = await database.getAllAsync<{
    id: string;
    started_at: string;
  }>(
    `SELECT id, started_at FROM reader_reading_sessions
     WHERE local_day_key IS NULL OR local_day_key = '';`,
  );
  let sessionsBackfilled = 0;
  for (const update of planLocalDayBackfill(
    legacySessions.map((row) => ({ id: row.id, timestamp: row.started_at })),
  )) {
    await database.runAsync(
      'UPDATE reader_reading_sessions SET local_day_key = ? WHERE id = ?;',
      [update.dayKey, update.id],
    );
    sessionsBackfilled += 1;
  }

  const legacyExcerpts = await database.getAllAsync<{
    id: number;
    created_at: string;
  }>(
    `SELECT id, created_at FROM reader_excerpts
     WHERE created_local_day_key IS NULL OR created_local_day_key = '';`,
  );
  let excerptsBackfilled = 0;
  for (const update of planLocalDayBackfill(
    legacyExcerpts.map((row) => ({ id: row.id, timestamp: row.created_at })),
  )) {
    await database.runAsync(
      'UPDATE reader_excerpts SET created_local_day_key = ? WHERE id = ?;',
      [update.dayKey, update.id],
    );
    excerptsBackfilled += 1;
  }

  return { sessionsBackfilled, excerptsBackfilled };
}
