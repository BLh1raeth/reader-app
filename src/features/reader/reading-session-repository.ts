import { getLibraryDatabase } from '../library/library-database';

/**
 * ReadingSession Core A repository.
 *
 * Raw behavioral facts only: active seconds and forward characters per
 * session. No aggregates, no streak logic, no UI queries — those belong to
 * the future Data Tab layer.
 *
 * Conventions follow the reader repository family: snake_case columns,
 * ISO-8601 TEXT timestamps, camelCase domain types via mapRow(), and a
 * named `readingSessionRepository` export.
 */

export type ReadingSessionCloseReason =
  | 'reader-exit'
  | 'app-background'
  | 'idle'
  | 'book-change'
  | 'day-rollover'
  | 'recovered-stale';

export type ReadingSession = {
  id: string;
  bookId: string;
  startedAt: string;
  endedAt: string | null;
  /** Effective active reading seconds (timestamp deltas, never timer ticks). */
  activeSeconds: number;
  startCfi: string | null;
  endCfi: string | null;
  startSectionIndex: number | null;
  endSectionIndex: number | null;
  /**
   * Behavior counter: characters the user actually advanced past while
   * reading forward. startCfi/endCfi are position markers only and must
   * never be used to derive this value.
   */
  forwardCharacters: number;
  lastInteractionAt: string | null;
  lastCheckpointAt: string | null;
  closeReason: ReadingSessionCloseReason | null;
  createdAt: string;
  updatedAt: string;
};

export type NewReadingSession = Omit<ReadingSession, 'createdAt' | 'updatedAt'>;

export type ReadingSessionUpdate = Partial<
  Pick<
    ReadingSession,
    | 'endedAt'
    | 'activeSeconds'
    | 'endCfi'
    | 'endSectionIndex'
    | 'forwardCharacters'
    | 'lastInteractionAt'
    | 'lastCheckpointAt'
    | 'closeReason'
  >
>;

export type ReadingSessionClose = {
  endedAt: string;
  endCfi: string | null;
  endSectionIndex: number | null;
  activeSeconds: number;
  forwardCharacters: number;
  closeReason: ReadingSessionCloseReason;
};

/** Minimal persistence surface the tracker needs (repository satisfies it). */
export type ReadingSessionStore = {
  createReadingSession(session: NewReadingSession): Promise<ReadingSession>;
  updateReadingSession(id: string, patch: ReadingSessionUpdate): Promise<void>;
  closeReadingSession(id: string, close: ReadingSessionClose): Promise<void>;
};

type ReadingSessionRow = {
  id: string;
  book_id: string;
  started_at: string;
  ended_at: string | null;
  active_seconds: number;
  start_cfi: string | null;
  end_cfi: string | null;
  start_section_index: number | null;
  end_section_index: number | null;
  forward_characters: number;
  last_interaction_at: string | null;
  last_checkpoint_at: string | null;
  close_reason: string | null;
  created_at: string;
  updated_at: string;
};

const CLOSE_REASONS: ReadonlySet<string> = new Set([
  'reader-exit',
  'app-background',
  'idle',
  'book-change',
  'day-rollover',
  'recovered-stale',
]);

function mapRow(row: ReadingSessionRow): ReadingSession {
  const closeReason = row.close_reason;
  return {
    id: row.id,
    bookId: row.book_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    activeSeconds: row.active_seconds,
    startCfi: row.start_cfi,
    endCfi: row.end_cfi,
    startSectionIndex: row.start_section_index,
    endSectionIndex: row.end_section_index,
    forwardCharacters: row.forward_characters,
    lastInteractionAt: row.last_interaction_at,
    lastCheckpointAt: row.last_checkpoint_at,
    closeReason: closeReason !== null && CLOSE_REASONS.has(closeReason)
      ? (closeReason as ReadingSessionCloseReason)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const readingSessionRepository = {
  async createReadingSession(session: NewReadingSession): Promise<ReadingSession> {
    const database = await getLibraryDatabase();
    const now = new Date().toISOString();
    await database.runAsync(
      `INSERT INTO reader_reading_sessions (
        id, book_id, started_at, ended_at, active_seconds,
        start_cfi, end_cfi, start_section_index, end_section_index,
        forward_characters, last_interaction_at, last_checkpoint_at,
        close_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      session.id,
      session.bookId,
      session.startedAt,
      session.endedAt,
      session.activeSeconds,
      session.startCfi,
      session.endCfi,
      session.startSectionIndex,
      session.endSectionIndex,
      session.forwardCharacters,
      session.lastInteractionAt,
      session.lastCheckpointAt,
      session.closeReason,
      now,
      now,
    );
    const persisted = await readingSessionRepository.getReadingSessionById(session.id);
    if (!persisted) throw new Error('阅读会话写入后无法重新读取。');
    return persisted;
  },

  async getReadingSessionById(id: string): Promise<ReadingSession | null> {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<ReadingSessionRow>(
      'SELECT * FROM reader_reading_sessions WHERE id = ?;',
      id,
    );
    return row ? mapRow(row) : null;
  },

  async updateReadingSession(id: string, patch: ReadingSessionUpdate): Promise<void> {
    const database = await getLibraryDatabase();
    const now = new Date().toISOString();
    const columns: string[] = [];
    const values: Array<string | number | null> = [];
    const assign = (column: string, value: string | number | null) => {
      columns.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.endedAt !== undefined) assign('ended_at', patch.endedAt);
    if (patch.activeSeconds !== undefined) assign('active_seconds', patch.activeSeconds);
    if (patch.endCfi !== undefined) assign('end_cfi', patch.endCfi);
    if (patch.endSectionIndex !== undefined) assign('end_section_index', patch.endSectionIndex);
    if (patch.forwardCharacters !== undefined) assign('forward_characters', patch.forwardCharacters);
    if (patch.lastInteractionAt !== undefined) assign('last_interaction_at', patch.lastInteractionAt);
    if (patch.lastCheckpointAt !== undefined) assign('last_checkpoint_at', patch.lastCheckpointAt);
    if (patch.closeReason !== undefined) assign('close_reason', patch.closeReason);
    if (columns.length === 0) return;
    columns.push('updated_at = ?');
    values.push(now, id);
    await database.runAsync(
      `UPDATE reader_reading_sessions SET ${columns.join(', ')} WHERE id = ?;`,
      ...values,
    );
  },

  async closeReadingSession(id: string, close: ReadingSessionClose): Promise<void> {
    await readingSessionRepository.updateReadingSession(id, {
      endedAt: close.endedAt,
      endCfi: close.endCfi,
      endSectionIndex: close.endSectionIndex,
      activeSeconds: close.activeSeconds,
      forwardCharacters: close.forwardCharacters,
      closeReason: close.closeReason,
    });
  },

  async getOpenReadingSessions(): Promise<ReadingSession[]> {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<ReadingSessionRow>(
      'SELECT * FROM reader_reading_sessions WHERE ended_at IS NULL ORDER BY started_at ASC;',
    );
    return rows.map(mapRow);
  },

  /**
   * Crash recovery. Closes every session left open (ended_at IS NULL) at its
   * last checkpoint — never at "now", so offline/killed time is not invented
   * as reading time. Runs once during database bootstrap.
   */
  async recoverStaleReadingSessions(): Promise<number> {
    const stale = await readingSessionRepository.getOpenReadingSessions();
    for (const session of stale) {
      const boundary = session.lastCheckpointAt ?? session.startedAt;
      await readingSessionRepository.closeReadingSession(session.id, {
        endedAt: boundary,
        endCfi: session.endCfi,
        endSectionIndex: session.endSectionIndex,
        activeSeconds: session.activeSeconds,
        forwardCharacters: session.forwardCharacters,
        closeReason: 'recovered-stale',
      });
    }
    return stale.length;
  },

  async listReadingSessionsForBook(bookId: string): Promise<ReadingSession[]> {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<ReadingSessionRow>(
      `SELECT * FROM reader_reading_sessions
       WHERE book_id = ?
       ORDER BY started_at DESC;`,
      bookId,
    );
    return rows.map(mapRow);
  },

  /**
   * Sessions fully inside [startIso, endIso). Sessions never cross a local
   * day (day-rollover splits them), so started_at range queries are exact
   * for future per-day aggregates.
   */
  async listReadingSessionsBetween(startIso: string, endIso: string): Promise<ReadingSession[]> {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<ReadingSessionRow>(
      `SELECT * FROM reader_reading_sessions
       WHERE started_at >= ? AND started_at < ?
       ORDER BY started_at ASC;`,
      startIso,
      endIso,
    );
    return rows.map(mapRow);
  },

  /**
   * DEV-only inspector. No formal UI in Core A; the tracker also emits
   * [READING_SESSION_*] logs at start/checkpoint/close.
   */
  async debugLogRecentReadingSessions(bookId?: string, limit = 10): Promise<void> {
    if (!__DEV__) return;
    const database = await getLibraryDatabase();
    const rows = bookId
      ? await database.getAllAsync<ReadingSessionRow>(
          `SELECT * FROM reader_reading_sessions
           WHERE book_id = ?
           ORDER BY started_at DESC LIMIT ?;`,
          bookId,
          limit,
        )
      : await database.getAllAsync<ReadingSessionRow>(
          `SELECT * FROM reader_reading_sessions
           ORDER BY started_at DESC LIMIT ?;`,
          limit,
        );
    console.log(
      '[READING_SESSIONS_DEBUG]',
      JSON.stringify(rows.map((row) => {
        const session = mapRow(row);
        return {
          id: session.id,
          bookId: session.bookId,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          activeSeconds: Math.round(session.activeSeconds * 10) / 10,
          forwardCharacters: session.forwardCharacters,
          closeReason: session.closeReason,
          startSectionIndex: session.startSectionIndex,
          endSectionIndex: session.endSectionIndex,
        };
      })),
    );
  },
};
