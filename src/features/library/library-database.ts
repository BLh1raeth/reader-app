import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'reader-library.db';
const SCHEMA_VERSION = 4;

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
          percentage REAL NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
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
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    });
  }
  return database;
}
