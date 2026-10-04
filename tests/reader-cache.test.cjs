const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const { createSQLiteMock } = require('./helpers/sqlite-fixture.cjs');
const root = path.join(__dirname, '../src/features');

test('pagination cache retains three layouts per book and the current layout even with an older timestamp', async () => {
  const load = createTypeScriptLoader({ 'expo-sqlite': createSQLiteMock() });
  const database = await load(path.join(root, 'library/library-database.ts')).getLibraryDatabase();
  database.native.exec(`INSERT INTO books (id,title,format,file_uri,file_hash,file_size,added_at,reading_status,manual_order,original_title,metadata_json,toc_json)
    VALUES ('one','Book','epub','file:///one.epub','hash',1,'2026-10-01','unread',0,'Book','{}','[]');`);
  const repo = load(path.join(root, 'reader/reader-page-cache-repository.ts')).readerPageCacheRepository;
  for (let i = 0; i < 5; i++) await repo.upsert({ bookId: 'one', layoutSignature: 'layout-' + i, totalPages: 10, sectionPages: [0, 10], updatedAt: '2026-10-0' + (i + 1) });
  assert.equal(database.native.prepare('SELECT count(*) AS n FROM reader_page_cache').get().n, 3);
  await repo.upsert({ bookId: 'one', layoutSignature: 'current', totalPages: 11, sectionPages: [0, 11], updatedAt: '2026-09-01' });
  const rows = database.native.prepare('SELECT layout_signature FROM reader_page_cache').all();
  assert.equal(rows.length, 3); assert.ok(rows.some((row) => row.layout_signature === 'current'));
  assert.deepEqual((await repo.getMostRecent('one')).sectionPages, [0, 10]);
});

test('parallel analytics requests share one in-flight read and refreshes still read current records', async () => {
  const load = createTypeScriptLoader({ 'expo-sqlite': createSQLiteMock() });
  const database = await load(path.join(root, 'library/library-database.ts')).getLibraryDatabase();
  const original = database.getAllAsync.bind(database); let reads = 0;
  database.getAllAsync = async (...args) => { reads++; await new Promise((resolve) => setTimeout(resolve, 1)); return original(...args); };
  const service = load(path.join(root, 'data/reading-analytics-service.ts'));
  const now = new Date('2026-10-01T12:00:00Z');
  await Promise.all([
    service.getReadingAnalyticsSummary(now),
    service.getDailyReadingStats({ startDay: '2026-10-01', endDay: '2026-10-01' }),
    service.getTodayHourlyActiveSeconds(now),
  ]);
  assert.equal(reads, 3);
  await service.getReadingAnalyticsSummary(now); assert.equal(reads, 6);
});
