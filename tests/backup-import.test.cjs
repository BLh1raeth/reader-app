const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');

const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const { createFileSystemMock } = require('./helpers/file-system-fixture.cjs');
const { createDatabase, createSQLiteMock } = require('./helpers/sqlite-fixture.cjs');

const librarySource = path.join(__dirname, '..', 'src', 'features', 'library');
const oldHash = require('node:crypto').createHash('sha256').update(Uint8Array.of(4, 5, 6)).digest('hex');
const newHash = require('node:crypto').createHash('sha256').update(Uint8Array.of(1, 2, 3)).digest('hex');

function insertBook(database, id, hash, fileUri) {
  database.native.prepare(`
    INSERT INTO books (id, title, format, file_uri, file_hash, file_size,
      added_at, reading_status, manual_order, original_title, metadata_json, toc_json)
    VALUES (?, ?, 'epub', ?, ?, 3, '2026-09-27T00:00:00.000Z', 'unread', 0, ?, '{}', '[]');
  `).run(id, id, fileUri, hash, id);
}

async function fixture() {
  const fs = createFileSystemMock();
  const sqlite = createSQLiteMock();
  const load = createTypeScriptLoader({
    'expo-file-system': fs,
    'expo-sqlite': sqlite,
  });
  const library = load(path.join(librarySource, 'library-database.ts'));
  const backup = load(path.join(librarySource, 'backup-service.ts'));
  const live = await library.getLibraryDatabase();
  const oldUri = 'file:///docs/Library/Books/book-old.epub';
  insertBook(live, 'book-old', oldHash, oldUri);
  fs.files.set(oldUri, new Uint8Array([4, 5, 6]));

  const candidate = createDatabase();
  await library.migrateLibraryDatabase(candidate);
  insertBook(candidate, 'book-new', newHash, 'file:///another-device/book-new.epub');
  candidate.native.exec(`
    INSERT INTO reader_excerpts (book_id, text, start_cfi, end_cfi, range_cfi,
      section_index, created_at, updated_at, created_local_day_key)
    VALUES ('book-new', '原文', 'start', 'end', 'epubcfi(/6/4!/4/2,/1:0,/1:3)', 0,
      '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z', '2026-09-27');
  `);
  const databaseBytes = await candidate.serializeAsync();
  await candidate.closeAsync();

  async function archive(includeEpub) {
    const zip = new JSZip();
    zip.file('reader-library.db', databaseBytes);
    zip.file('manifest.json', JSON.stringify({
      app: 'reader', backupFormatVersion: 1,
      exportedAt: '2026-09-27T00:00:00.000Z', schemaVersion: library.SCHEMA_VERSION,
      books: [{
        id: 'book-new', fileHash: newHash,
        hasFile: true, hasCover: false, coverExtension: null,
      }],
    }));
    if (includeEpub) zip.file('books/book-new.epub', new Uint8Array([1, 2, 3]));
    fs.files.set('file:///input.zip', await zip.generateAsync({ type: 'uint8array' }));
  }
  return { archive, backup, fs, live, oldUri, sqlite };
}

test('missing EPUB aborts before committing and preserves the old library', async () => {
  const { archive, backup, fs, live, oldUri, sqlite } = await fixture();
  await archive(false);
  await assert.rejects(backup.importBackup('file:///input.zip'),
    (error) => error.code === 'incomplete-backup');
  assert.equal(sqlite.backupCalls, 0);
  assert.deepEqual(live.native.prepare('SELECT id FROM books;').all().map((row) => row.id), ['book-old']);
  assert.ok(fs.files.has(oldUri));
});

test('validated import commits the new database and asset set together', async () => {
  const { archive, backup, fs, live, oldUri, sqlite } = await fixture();
  await archive(true);
  const result = await backup.importBackup('file:///input.zip');
  assert.equal(result.bookCount, 1);
  assert.equal(sqlite.backupCalls, 1);
  const books = live.native.prepare('SELECT id, file_uri FROM books;').all();
  assert.equal(books.length, 1);
  assert.equal(books[0].id, 'book-new');
  assert.match(books[0].file_uri, /^file:\/\/\/docs\/Library\/Restores\/restore-/);
  assert.ok(fs.files.has(books[0].file_uri));
  assert.equal(fs.files.has(oldUri), false);
  assert.equal(live.native.prepare('SELECT range_cfi FROM reader_excerpts;').get().range_cfi,
    'epubcfi(/6/4!/4/2,/1:0,/1:3)');
});

test('SQLite commit failure retains the old database and removes staged assets', async () => {
  const { archive, backup, fs, live, oldUri, sqlite } = await fixture();
  await archive(true);
  sqlite.failBackupOnce();
  await assert.rejects(backup.importBackup('file:///input.zip'), /simulated SQLite backup failure/);
  assert.deepEqual(live.native.prepare('SELECT id FROM books;').all().map((row) => row.id), ['book-old']);
  assert.ok(fs.files.has(oldUri));
  assert.equal([...fs.files.keys()].some((uri) => uri.includes('/Restores/')), false);
});

test('corrupt asset bytes or forged expanded sizes leave the current library untouched', async () => {
  const { archive, backup, fs, live, oldUri, sqlite } = await fixture();
  await archive(true);
  const zip = await JSZip.loadAsync(fs.files.get('file:///input.zip'));
  zip.file('books/book-new.epub', Uint8Array.of(9, 8, 7));
  fs.files.set('file:///input.zip', await zip.generateAsync({ type: 'uint8array' }));
  await assert.rejects(backup.importBackup('file:///input.zip'), (error) => error.code === 'incomplete-backup');
  assert.equal(sqlite.backupCalls, 0);
  assert.equal(live.native.prepare('SELECT id FROM books').get().id, 'book-old');
  assert.ok(fs.files.has(oldUri));
  await archive(true);
  const compressed = await JSZip.loadAsync(fs.files.get('file:///input.zip'));
  const bytes = await compressed.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const firstCentral = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(firstCentral + 24, 8, true);
  fs.files.set('file:///input.zip', bytes);
  await assert.rejects(backup.importBackup('file:///input.zip'), /超过声明大小/);
  assert.equal(sqlite.backupCalls, 0);
});

test('export/import round trip includes archives, tags, settings and annotations without archived files', async () => {
  const { backup, fs, live, oldUri } = await fixture();
  live.native.exec(`
    INSERT INTO book_tags (book_id, tag) VALUES ('book-old', '收藏');
    INSERT INTO reader_settings (id,font_size,page_transition,line_height,page_margin,updated_at,appearance_mode,font_family)
    VALUES (1,19,'dissolve',1.72,7,'2026-10-01','system','serif');
    INSERT INTO reader_excerpts (book_id,text,start_cfi,end_cfi,range_cfi,section_index,created_at,updated_at)
    VALUES ('book-old','保留的摘录','start','end','range',0,'2026-10-01','2026-10-01');
    UPDATE books SET archived_at = '2026-10-01';
  `);
  const result = await backup.exportBackup(new Date('2026-10-01T00:00:00Z'));
  const zip = await JSZip.loadAsync(fs.files.get(result.uri), { checkCRC32: true });
  assert.equal(zip.file('books/book-old.epub'), null);
  await backup.importBackup(result.uri);
  assert.equal(live.native.prepare('SELECT archived_at FROM books').get().archived_at, '2026-10-01');
  assert.equal(live.native.prepare('SELECT tag FROM book_tags').get().tag, '收藏');
  assert.equal(live.native.prepare('SELECT text FROM reader_excerpts').get().text, '保留的摘录');
  assert.equal(live.native.prepare('SELECT font_family FROM reader_settings').get().font_family, 'serif');
  assert.equal(fs.files.has(oldUri), false);
});
