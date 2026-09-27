const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const { createSQLiteMock } = require('./helpers/sqlite-fixture.cjs');
const load = createTypeScriptLoader();
const root = path.join(__dirname, '..', 'src', 'features', 'reader');
const navigation = load(path.join(root, 'reader-external-navigation.ts'));
const pagination = load(path.join(root, 'reader-pagination.ts'));

test('excerpt CFI navigation is matched to its book and consumed only once', () => {
  navigation.clearReaderExternalNavigationRequest();
  const request = navigation.createReaderExternalNavigationRequest('book-1', 'epubcfi(/6/4!/4/2,/1:0,/1:3)');
  assert.equal(navigation.takeReaderExternalNavigationRequest('book-2'), null);
  assert.equal(navigation.takeReaderExternalNavigationRequest('book-1'), request);
  assert.equal(navigation.takeReaderExternalNavigationRequest('book-1'), null);
  assert.equal(request.reason, 'annotation');
  assert.equal(request.reveal, true);
});

test('global page numbers include preceding sections but skip zero-page sections', () => {
  assert.equal(pagination.getGlobalReaderPage([5, 0, 8], 0, 1), 1);
  assert.equal(pagination.getGlobalReaderPage([5, 0, 8], 2, 3), 8);
  assert.equal(pagination.getGlobalReaderPage([5, 0, 8], 3, 1), 14);
});

test('saved excerpt range CFI survives typography settings changes', async () => {
  const sqlite = createSQLiteMock();
  const loadWithDatabase = createTypeScriptLoader({ 'expo-sqlite': sqlite });
  const library = loadWithDatabase(path.join(root, '..', 'library', 'library-database.ts'));
  const excerpts = loadWithDatabase(path.join(root, 'excerpt-repository.ts')).excerptRepository;
  const settings = loadWithDatabase(path.join(root, 'reader-settings-repository.ts')).readerSettingsRepository;
  const database = await library.getLibraryDatabase();
  database.native.exec(`
    INSERT INTO books (id, title, format, file_uri, file_hash, file_size,
      added_at, reading_status, manual_order, original_title, metadata_json, toc_json)
    VALUES ('book-1', 'Book', 'epub', 'file:///book.epub', '${'a'.repeat(64)}', 1,
      '2026-09-27T00:00:00.000Z', 'reading', 0, 'Book', '{}', '[]');
  `);
  const rangeCfi = 'epubcfi(/6/4!/4/2,/1:0,/1:3)';
  const saved = await excerpts.createExcerpt({
    bookId: 'book-1', text: '原文', startCfi: 'epubcfi(/6/4!/4/2/1:0)',
    endCfi: 'epubcfi(/6/4!/4/2/1:3)', rangeCfi,
    chapterTitle: '第一章', sectionIndex: 0,
  });
  assert.equal(saved.created, true);
  const defaults = await settings.get();
  await settings.upsert({
    ...defaults, fontSize: defaults.fontSize + 2,
    lineHeight: defaults.lineHeight + 0.2,
    letterSpacing: defaults.letterSpacing + 0.01,
    pageMargin: defaults.pageMargin + 0.01,
  });
  const restored = await excerpts.getExcerptById(saved.excerpt.id);
  assert.equal(restored.rangeCfi, rangeCfi);
  assert.equal(restored.text, '原文');
});
