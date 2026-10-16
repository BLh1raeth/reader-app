const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const { zipSync, strToU8 } = require('fflate');
const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const { createSQLiteMock } = require('./helpers/sqlite-fixture.cjs');
const { createFileSystemMock } = require('./helpers/file-system-fixture.cjs');

test('actual import restores archived content at fresh paths without resetting reading records', async () => {
  const fs = createFileSystemMock();
  const bytes = zipSync({
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
    'book.opf': strToU8('<package><metadata><title>测试阅读</title><creator>作者</creator></metadata><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>'),
    'chapter.xhtml': strToU8('<html><body><p>测试正文</p></body></html>'),
  });
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const asset = { uri: 'file:///input.epub', name: 'book.epub', mimeType: 'application/epub+zip' };
  fs.files.set(asset.uri, bytes);
  const load = createTypeScriptLoader({
    'expo-file-system': fs, 'expo-sqlite': createSQLiteMock(),
    'expo-document-picker': { getDocumentAsync: async () => ({ canceled: false, assets: [asset] }) },
    'expo-haptics': { impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light' } },
    'expo-sharing': {},
  });
  const root = path.join(__dirname, '../src/features/library');
  const database = await load(path.join(root, 'library-database.ts')).getLibraryDatabase();
  const repo = load(path.join(root, 'book-repository.ts')).bookRepository;
  const imports = load(path.join(root, 'library-import-service.ts'));
  const first = await imports.importPickedEpubs(async () => { throw new Error('unexpected duplicate'); });
  assert.deepEqual(first.failures, []); const book = first.imported[0];
  database.native.prepare("UPDATE books SET title = '我的书名', reading_status = 'reading' WHERE id = ?").run(book.id);
  database.native.prepare('INSERT INTO book_tags (book_id, tag) VALUES (?, ?)').run(book.id, '收藏');
  database.native.prepare(`INSERT INTO reader_excerpts (book_id,text,start_cfi,end_cfi,range_cfi,section_index,created_at,updated_at)
    VALUES (?,'摘录','a','b','range',0,'2026-10-01','2026-10-01')`).run(book.id);
  await repo.removeBooks([book], false); // Leave old file and cleanup job pending.
  const restored = await imports.importPickedEpubs(async () => { throw new Error('restoration should not require duplicate confirmation'); });
  assert.deepEqual(restored.failures, []); const replacement = restored.imported[0];
  assert.equal(replacement.id, book.id); assert.notEqual(replacement.fileUri, book.fileUri);
  assert.equal(replacement.title, '我的书名'); assert.equal(replacement.readingStatus, 'reading');
  assert.deepEqual(replacement.tags, ['收藏']);
  assert.equal(database.native.prepare('SELECT count(*) AS n FROM reader_excerpts').get().n, 1);
  await load(path.join(root, 'file-cleanup.ts')).retryFileCleanup();
  assert.equal(fs.files.has(book.fileUri), false); assert.equal(fs.files.has(replacement.fileUri), true);
  assert.equal((await repo.getAllBooks()).length, 1);
});
