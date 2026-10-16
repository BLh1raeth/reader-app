const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const { createSQLiteMock } = require('./helpers/sqlite-fixture.cjs');
const root = path.join(__dirname, '../src/features');

test('search and tag/status filters exclude archived books except in archive view', () => {
  const { filterLibraryBooks } = createTypeScriptLoader()(path.join(root, 'library/library-filter.ts'));
  const books = [
    { id: '1', title: '中文阅读', author: 'Author', tags: ['科幻'], readingStatus: 'reading' },
    { id: '2', title: 'Other', author: null, tags: ['科幻'], readingStatus: 'unread', archivedAt: 'date' },
    { id: '3', title: 'Other', author: 'Writer', tags: [], readingStatus: 'finished' },
  ];
  assert.deepEqual(filterLibraryBooks(books, 'all', ' author ').map((book) => book.id), ['1']);
  assert.deepEqual(filterLibraryBooks(books, 'tag:科幻', '').map((book) => book.id), ['1']);
  assert.deepEqual(filterLibraryBooks(books, 'archived', '').map((book) => book.id), ['2']);
  assert.deepEqual(filterLibraryBooks(books, 'finished', 'other').map((book) => book.id), ['3']);
});

test('Markdown export groups by book identity and preserves multiline quotations safely', () => {
  const { excerptsToMarkdown } = createTypeScriptLoader()(path.join(root, 'excerpts/excerpt-export.ts'));
  const text = excerptsToMarkdown([
    { bookId: 'one', bookTitle: 'Book #1', quoteText: '第一行\n<script>text</script>', createdAt: '2026-10-01' },
    { bookId: 'two', bookTitle: 'Book #1', quoteText: '另一本', chapterTitle: 'Chapter', createdAt: '2026-10-02' },
  ]);
  assert.equal((text.match(/^## /gm) ?? []).length, 2);
  assert.ok(text.includes('Book \\#1'));
  assert.ok(text.includes('> 第一行\n> &lt;script&gt;text&lt;/script&gt;'));
  assert.ok(text.includes('Chapter · 2026-10-02'));
});

test('editing an excerpt preserves its CFI and calendar identity; deletion leaves book intact', async () => {
  const load = createTypeScriptLoader({ 'expo-sqlite': createSQLiteMock() });
  const database = await load(path.join(root, 'library/library-database.ts')).getLibraryDatabase();
  database.native.exec(`INSERT INTO books (id,title,format,file_uri,file_hash,file_size,added_at,reading_status,manual_order,original_title,metadata_json,toc_json)
    VALUES ('one','Book','epub','file:///one.epub','hash',1,'2026-10-01','unread',0,'Book','{}','[]');`);
  const repo = load(path.join(root, 'reader/excerpt-repository.ts')).excerptRepository;
  const { excerpt } = await repo.createExcerpt({ bookId: 'one', text: '原文', startCfi: 'start', endCfi: 'end', rangeCfi: 'range', chapterTitle: null, sectionIndex: 0 });
  const before = database.native.prepare('SELECT * FROM reader_excerpts').get();
  await repo.updateExcerptText(excerpt.id, '修改后的摘录');
  const after = database.native.prepare('SELECT * FROM reader_excerpts').get();
  for (const key of ['range_cfi', 'start_cfi', 'end_cfi', 'created_at', 'created_local_day_key']) assert.equal(after[key], before[key]);
  assert.equal(after.text, '修改后的摘录');
  await assert.rejects(repo.updateExcerptText(excerpt.id, '  '));
  await repo.deleteExcerpt(excerpt.id);
  assert.equal(database.native.prepare('SELECT count(*) AS n FROM books').get().n, 1);
});

test('font and appearance preferences round trip, preserving legacy manual appearance', async () => {
  const load = createTypeScriptLoader({ 'expo-sqlite': createSQLiteMock() });
  const database = await load(path.join(root, 'library/library-database.ts')).getLibraryDatabase();
  const repo = load(path.join(root, 'reader/reader-settings-repository.ts')).readerSettingsRepository;
  const defaults = await repo.get();
  await repo.upsert({ ...defaults, appearance: 'system', fontFamily: 'serif' });
  assert.equal((await repo.get()).fontFamily, 'serif');
  assert.equal((await repo.get()).appearance, 'system');
  database.native.exec("UPDATE reader_settings SET appearance_mode = NULL, reader_appearance = 'dark'");
  assert.equal((await repo.get()).appearance, 'dark');
});

test('jump history follows user jumps, supports repeated returns and ignores pagination', () => {
  const { ReaderJumpHistory } = createTypeScriptLoader()(path.join(root, 'reader/reader-jump-history.ts'));
  const history = new ReaderJumpHistory();
  const observe = (cfi, navigationReason) => history.observe({ cfi, navigationReason }, 'active');
  observe('a', 'restore'); observe('b', 'reading-forward'); observe('c', 'toc'); observe('d', 'search');
  assert.equal(history.peek(), 'c');
  observe('c', 'programmatic'); history.confirmReturn('c'); assert.equal(history.peek(), 'b');
  observe('b', 'settings-repagination'); assert.equal(history.peek(), 'b');
  history.reset(); assert.equal(history.canReturn, false);
});
