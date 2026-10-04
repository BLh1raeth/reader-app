const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const { createSQLiteMock } = require('./helpers/sqlite-fixture.cjs');
const { createFileSystemMock } = require('./helpers/file-system-fixture.cjs');

async function fixture() {
  const fs = createFileSystemMock();
  const load = createTypeScriptLoader({ 'expo-sqlite': createSQLiteMock(), 'expo-file-system': fs });
  const root = path.join(__dirname, '..', 'src/features/library');
  const database = await load(path.join(root, 'library-database.ts')).getLibraryDatabase();
  const repo = load(path.join(root, 'book-repository.ts')).bookRepository;
  const cleanup = load(path.join(root, 'file-cleanup.ts')).retryFileCleanup;
  const uri = 'file:///docs/Library/Books/one.epub';
  fs.files.set(uri, Uint8Array.of(1, 2));
  database.native.exec(`
    INSERT INTO books (id, title, format, file_uri, file_hash, file_size, added_at,
      reading_status, manual_order, original_title, metadata_json, toc_json)
    VALUES ('one','Title','epub','${uri}','hash',2,'2026-10-01','unread',0,'Title','{}','[]');
    INSERT INTO reader_excerpts (book_id,text,start_cfi,end_cfi,range_cfi,section_index,created_at,updated_at)
    VALUES ('one','Quote','a','b','range',0,'2026-10-01','2026-10-01');
    INSERT INTO reader_reading_sessions (id,book_id,started_at,created_at,updated_at)
    VALUES ('session','one','2026-10-01','2026-10-01','2026-10-01');
  `);
  return { fs, database, repo, cleanup, uri, book: await repo.getBookById('one') };
}

test('archive keeps annotations/history and exact re-import restores the same id', async () => {
  const { fs, database, repo, cleanup, uri, book } = await fixture();
  await repo.removeBooks([book], false); await cleanup();
  assert.equal((await repo.getAllBooks()).length, 0);
  assert.equal(database.native.prepare('SELECT count(*) AS n FROM reader_excerpts').get().n, 1);
  assert.equal(database.native.prepare('SELECT count(*) AS n FROM reader_reading_sessions').get().n, 1);
  assert.equal(fs.files.has(uri), false);
  assert.equal((await repo.getDuplicate(null, 'hash', 'Title')).id, 'one');
  fs.files.set(uri, Uint8Array.of(1, 2));
  await repo.restoreBookFile('one', uri, null);
  assert.equal((await repo.getAllBooks())[0].id, 'one');
  assert.equal((await repo.getBookById('one')).archivedAt, null);
});

test('a database transaction failure preserves the book and its files', async () => {
  const { fs, database, repo, cleanup, uri, book } = await fixture();
  database.interruptBefore(database.transactionCount + 1);
  await assert.rejects(repo.removeBooks([book], true), /simulated interruption/);
  await cleanup();
  assert.equal(fs.files.has(uri), true);
  assert.equal((await repo.getAllBooks()).length, 1);
});

test('permanent deletion cascades records only after explicit selection', async () => {
  const { fs, database, repo, cleanup, uri, book } = await fixture();
  database.native.exec("INSERT INTO reader_speed_samples (book_id, local_day_key, sampled_at, chars) VALUES ('one', '2026-10-01', '2026-10-01', 300)");
  await repo.removeBooks([book], true); await cleanup();
  assert.equal(await repo.getBookById('one'), null);
  assert.equal(database.native.prepare('SELECT count(*) AS n FROM reader_excerpts').get().n, 0);
  assert.equal(database.native.prepare('SELECT count(*) AS n FROM reader_speed_samples').get().n, 0);
  assert.equal(fs.files.has(uri), false);
});

test('failed file cleanup remains queued and can be retried', async () => {
  const { fs, database, repo, cleanup, uri, book } = await fixture();
  const original = fs.File.prototype.delete;
  fs.File.prototype.delete = () => { throw new Error('file busy'); };
  await repo.removeBooks([book], false); await cleanup();
  assert.equal(database.native.prepare('SELECT count(*) AS n FROM library_file_cleanup').get().n, 1);
  fs.File.prototype.delete = original;
  await cleanup();
  assert.equal(fs.files.has(uri), false);
  assert.equal(database.native.prepare('SELECT count(*) AS n FROM library_file_cleanup').get().n, 0);
});

test('queued cleanup after restore cannot delete a replacement file or an active reference', async () => {
  const { fs, database, repo, cleanup, uri, book } = await fixture();
  await repo.removeBooks([book], false);
  const replacement = 'file:///docs/Library/Books/one-restore-new.epub';
  fs.files.set(replacement, Uint8Array.of(1, 2));
  await repo.restoreBookFile('one', replacement, null);
  await cleanup();
  assert.equal(fs.files.has(uri), false); assert.equal(fs.files.has(replacement), true);
  database.native.prepare('INSERT INTO library_file_cleanup (uri) VALUES (?)').run(replacement);
  await cleanup(); assert.equal(fs.files.has(replacement), true);
});
