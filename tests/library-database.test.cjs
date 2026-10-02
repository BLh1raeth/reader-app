const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const { createDatabase } = require('./helpers/sqlite-fixture.cjs');

const source = path.join(__dirname, '..', 'src', 'features', 'library', 'library-database.ts');

function loadMigrations() {
  return createTypeScriptLoader({ 'expo-sqlite': {} })(source).migrateLibraryDatabase;
}

function version(database) {
  return database.native.prepare('PRAGMA user_version;').get().user_version;
}

test('interrupted migration records the last completed step and resumes to v21', async () => {
  const database = createDatabase();
  const migrate = loadMigrations();
  database.interruptBefore(15);
  await assert.rejects(migrate(database), /simulated interruption/);
  assert.equal(version(database), 14);
  assert.equal(database.native.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE name = 'reader_reading_sessions';",
  ).get().n, 0);

  database.interruptBefore(null);
  await migrate(database);
  assert.equal(version(database), 21);
  for (const name of ['reader_highlights', 'reader_reading_sessions', 'reader_speed_samples', 'reader_daily_goals']) {
    assert.equal(database.native.prepare(
      'SELECT count(*) AS n FROM sqlite_master WHERE name = ?;',
    ).get(name).n, 1, name);
  }
  await database.closeAsync();
});

test('repairs a legacy partial schema already mislabeled v19, including local-day backfill', async () => {
  const database = createDatabase();
  const migrate = loadMigrations();
  database.interruptBefore(16);
  await assert.rejects(migrate(database), /simulated interruption/);
  assert.equal(version(database), 15);
  database.native.exec(`
    INSERT INTO books (id, title, format, file_uri, file_hash, file_size,
      added_at, reading_status, manual_order, original_title, metadata_json, toc_json)
    VALUES ('book-old', 'Old', 'epub', 'file:///old.epub', '${'a'.repeat(64)}', 1,
      '2026-09-26T10:00:00.000Z', 'reading', 0, 'Old', '{}', '[]');
    INSERT INTO reader_reading_sessions (id, book_id, started_at, created_at, updated_at)
    VALUES ('session-1', 'book-old', '2026-09-26T10:00:00.000Z',
      '2026-09-26T10:00:00.000Z', '2026-09-26T10:00:00.000Z');
    INSERT INTO reader_excerpts (book_id, text, start_cfi, end_cfi, range_cfi,
      section_index, created_at, updated_at)
    VALUES ('book-old', '文字', 'a', 'b', 'range', 0,
      '2026-09-26T10:00:00.000Z', '2026-09-26T10:00:00.000Z');
    PRAGMA user_version = 19;
  `);
  database.interruptBefore(null);
  await migrate(database);

  assert.equal(version(database), 21);
  assert.match(database.native.prepare(
    "SELECT local_day_key FROM reader_reading_sessions WHERE id = 'session-1';",
  ).get().local_day_key, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(database.native.prepare(
    'SELECT created_local_day_key FROM reader_excerpts LIMIT 1;',
  ).get().created_local_day_key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(database.native.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE name = 'reader_daily_goals';",
  ).get().n, 1);
  await database.closeAsync();
});

test('v20 adds color_temp to reader_settings with default 0', async () => {
  const database = createDatabase();
  const migrate = loadMigrations();
  await migrate(database);
  assert.equal(version(database), 21);
  const columns = database.native.prepare('PRAGMA table_info(reader_settings);').all();
  const colorTemp = columns.find((column) => column.name === 'color_temp');
  assert.ok(colorTemp, 'color_temp column exists');
  assert.equal(colorTemp.dflt_value, '0');
  // Round-trip: write a non-default value and read it back.
  database.native.exec(`
    INSERT INTO reader_settings (id, font_size, page_transition, line_height, page_margin, updated_at, color_temp)
    VALUES (1, 19, 'dissolve', 1.72, 7, '2026-10-02T00:00:00.000Z', 0.5);
  `);
  assert.equal(
    database.native.prepare('SELECT color_temp FROM reader_settings WHERE id = 1;').get().color_temp,
    0.5,
  );
  await database.closeAsync();
});

test('v21 adds page_indicator_mode to reader_settings with default pages', async () => {
  const database = createDatabase();
  const migrate = loadMigrations();
  await migrate(database);
  assert.equal(version(database), 21);
  const columns = database.native.prepare('PRAGMA table_info(reader_settings);').all();
  const indicatorMode = columns.find((column) => column.name === 'page_indicator_mode');
  assert.ok(indicatorMode, 'page_indicator_mode column exists');
  assert.equal(indicatorMode.dflt_value, "'pages'");
  database.native.exec(`
    INSERT INTO reader_settings (id, font_size, page_transition, line_height, page_margin, updated_at, page_indicator_mode)
    VALUES (1, 19, 'dissolve', 1.72, 7, '2026-10-02T00:00:00.000Z', 'chapter');
  `);
  assert.equal(
    database.native.prepare('SELECT page_indicator_mode FROM reader_settings WHERE id = 1;').get().page_indicator_mode,
    'chapter',
  );
  await database.closeAsync();
});

test('v21 repairs a device that stamped v20 before page_indicator_mode existed', async () => {
  // 复现真机 bug：v20 在开发期间被改过，已有设备 user_version=20 但缺列。
  const database = createDatabase();
  const migrate = loadMigrations();
  await migrate(database);
  assert.equal(version(database), 21);
  // 模拟：删掉 v21 加的列、把版本戳回 20（SQLite 3.35+ 支持 DROP COLUMN）。
  database.native.exec('ALTER TABLE reader_settings DROP COLUMN page_indicator_mode;');
  database.native.exec('PRAGMA user_version = 20;');
  await migrate(database);
  assert.equal(version(database), 21);
  const columns = database.native.prepare('PRAGMA table_info(reader_settings);').all();
  assert.ok(columns.some((column) => column.name === 'page_indicator_mode'), 'column repaired');
  assert.ok(columns.some((column) => column.name === 'color_temp'), 'color_temp untouched');
  await database.closeAsync();
});
