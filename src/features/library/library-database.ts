import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'reader-library.db';
const SCHEMA_VERSION = 15;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getLibraryDatabase() {
  if (!databasePromise) {
    databasePromise = bootstrapDatabase();
  }
  return databasePromise;
}

async function bootstrapDatabase() {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await database.execAsync('PRAGMA foreign_keys = ON;');

  const currentVersion = (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version ?? 0;
  if (currentVersion < 1) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS books (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          author TEXT,
          cover_uri TEXT,
          format TEXT NOT NULL,
          file_uri TEXT NOT NULL,
          file_hash TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          identifier TEXT,
          language TEXT,
          publisher TEXT,
          added_at TEXT NOT NULL,
          last_opened_at TEXT,
          reading_status TEXT NOT NULL CHECK (reading_status IN ('unread', 'reading', 'finished')),
          reading_progress REAL NOT NULL DEFAULT 0 CHECK (reading_progress >= 0 AND reading_progress <= 100),
          manual_order INTEGER NOT NULL,
          original_title TEXT NOT NULL,
          original_author TEXT,
          original_cover_uri TEXT,
          metadata_json TEXT NOT NULL,
          toc_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS books_manual_order_idx ON books(manual_order);
        CREATE INDEX IF NOT EXISTS books_file_hash_idx ON books(file_hash);
        CREATE INDEX IF NOT EXISTS books_identifier_idx ON books(identifier);
        PRAGMA user_version = 1;
      `);
    });
  }
  if (currentVersion < 2) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS reading_progress (
          book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          location TEXT NOT NULL,
          spine_index INTEGER NOT NULL,
          block_index INTEGER NOT NULL,
          percentage REAL NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 1),
          current_page INTEGER,
          total_pages INTEGER,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS reading_progress_updated_at_idx ON reading_progress(updated_at);
        PRAGMA user_version = 2;
      `);
    });
  }
  if (currentVersion < 3) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        ALTER TABLE reading_progress ADD COLUMN character_offset INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version = 3;
      `);
    });
  }
  if (currentVersion < 4) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      // `location` was used by the pre-foliate prototype. Keep it intact so
      // existing installs migrate without losing a saved position, while the
      // formal reader stores its stable EPUB CFI explicitly.
      await transaction.execAsync(`
        ALTER TABLE reading_progress ADD COLUMN cfi TEXT;
        PRAGMA user_version = 4;
      `);
    });
  }
  if (currentVersion < 5) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      // v2-v4 stored a display percentage (0-100). The sole Reader progress
      // source now stores the layout-independent fraction (0-1).
      await transaction.execAsync(`
        UPDATE reading_progress
        SET percentage = CASE WHEN percentage > 1 THEN percentage / 100.0 ELSE percentage END;
        -- books.reading_progress was a legacy display cache. Progress now
        -- comes only from the joined reading_progress row, so stale/mock
        -- values cannot re-enter the Library path.
        UPDATE books SET reading_progress = 0;
        PRAGMA user_version = 5;
      `);
    });
  }
  if (currentVersion < 6) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      // Page totals are layout-dependent. Keep them separate from the stable
      // CFI progress row so a viewport or typography change never corrupts a
      // reading location just because its pagination cache expires.
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS reader_page_cache (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          layout_signature TEXT NOT NULL,
          total_pages INTEGER NOT NULL CHECK (total_pages > 0),
          section_pages_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (book_id, layout_signature)
        );
        CREATE INDEX IF NOT EXISTS reader_page_cache_updated_at_idx ON reader_page_cache(updated_at);
        PRAGMA user_version = 6;
      `);
    });
  }
  if (currentVersion < 7) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      // Reader typography is global in the first settings release. A single
      // row avoids creating a second per-book preference/progress source.
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS reader_settings (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          font_size REAL NOT NULL,
          page_transition TEXT NOT NULL CHECK (page_transition = 'dissolve'),
          line_height REAL NOT NULL,
          page_margin REAL NOT NULL,
          updated_at TEXT NOT NULL
        );
        PRAGMA user_version = 7;
      `);
    });
  }
  if (currentVersion < 8) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        ALTER TABLE reader_settings ADD COLUMN letter_spacing REAL NOT NULL DEFAULT 0.01;
        PRAGMA user_version = 8;
      `);
    });
  }
  if (currentVersion < 9) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        ALTER TABLE reader_settings ADD COLUMN reader_appearance TEXT NOT NULL DEFAULT 'light'
          CHECK (reader_appearance IN ('light', 'dark'));
        PRAGMA user_version = 9;
      `);
    });
  }
  if (currentVersion < 10) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS book_search_history (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          query_key TEXT NOT NULL,
          query TEXT NOT NULL,
          searched_at TEXT NOT NULL,
          PRIMARY KEY (book_id, query_key)
        );
        CREATE INDEX IF NOT EXISTS book_search_history_recency_idx
          ON book_search_history(book_id, searched_at DESC);
        PRAGMA user_version = 10;
      `);
    });
  }
  if (currentVersion < 11) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS reader_bookmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          cfi TEXT NOT NULL,
          spine_index INTEGER NOT NULL,
          section_fraction REAL NOT NULL DEFAULT 0,
          chapter_title TEXT,
          excerpt TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          UNIQUE(book_id, cfi)
        );
        CREATE INDEX IF NOT EXISTS reader_bookmarks_book_order_idx
          ON reader_bookmarks(book_id, spine_index, section_fraction);
        PRAGMA user_version = 11;
      `);
    });
  }
  if (currentVersion < 12) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        ALTER TABLE reader_bookmarks ADD COLUMN page_number INTEGER;
        ALTER TABLE reader_bookmarks ADD COLUMN layout_signature TEXT;
        PRAGMA user_version = 12;
      `);
    });
  }
  if (currentVersion < 13) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS reader_excerpts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          start_cfi TEXT NOT NULL,
          end_cfi TEXT NOT NULL,
          range_cfi TEXT NOT NULL,
          chapter_title TEXT,
          section_index INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(book_id, range_cfi)
        );
        CREATE INDEX IF NOT EXISTS reader_excerpts_book_created_idx
          ON reader_excerpts(book_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS reader_excerpts_created_idx
          ON reader_excerpts(created_at DESC);
        PRAGMA user_version = 13;
      `);
    });
  }
  if (currentVersion < 14) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS reader_highlights (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          start_cfi TEXT NOT NULL,
          end_cfi TEXT NOT NULL,
          range_cfi TEXT NOT NULL,
          chapter_title TEXT,
          section_index INTEGER NOT NULL,
          color TEXT NOT NULL DEFAULT 'blue',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(book_id, range_cfi)
        );
        CREATE INDEX IF NOT EXISTS reader_highlights_book_section_idx
          ON reader_highlights(book_id, section_index);
        CREATE INDEX IF NOT EXISTS reader_highlights_book_created_idx
          ON reader_highlights(book_id, created_at DESC);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    });
  }
  if (currentVersion < 15) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      // ReadingSession Core A: behavioral reading data. Raw facts only
      // (active seconds, forward characters); no aggregates, no UI here.
      // forwardCharacters is the behavior counter; startCfi/endCfi are just
      // position markers and must never be used to derive characters.
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS reader_reading_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          active_seconds REAL NOT NULL DEFAULT 0,
          start_cfi TEXT,
          end_cfi TEXT,
          start_section_index INTEGER,
          end_section_index INTEGER,
          forward_characters INTEGER NOT NULL DEFAULT 0,
          last_interaction_at TEXT,
          last_checkpoint_at TEXT,
          close_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS reader_reading_sessions_book_started_idx
          ON reader_reading_sessions(book_id, started_at);
        CREATE INDEX IF NOT EXISTS reader_reading_sessions_started_idx
          ON reader_reading_sessions(started_at);
        CREATE INDEX IF NOT EXISTS reader_reading_sessions_open_idx
          ON reader_reading_sessions(ended_at) WHERE ended_at IS NULL;
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    });
  }
  // Stale-session recovery runs inside bootstrap with the live `database`
  // handle, never via the repository: the repository calls
  // getLibraryDatabase(), which is this same still-pending promise — routing
  // through it would deadlock bootstrap and hang every DB query (empty
  // library). A crash can leave ended_at NULL; recovered sessions close at
  // their last checkpoint without inventing unconfirmed reading time.
  const recoveredAt = new Date().toISOString();
  await database.runAsync(
    `UPDATE reader_reading_sessions
     SET ended_at = COALESCE(last_checkpoint_at, started_at),
         close_reason = 'recovered-stale',
         updated_at = ?
     WHERE ended_at IS NULL;`,
    [recoveredAt],
  );
  return database;
}
