const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');

const validation = createTypeScriptLoader()(
  path.join(__dirname, '..', 'src', 'features', 'library', 'backup-validation.ts'),
);
const book = {
  id: 'book-safe_1', fileHash: 'a'.repeat(64),
  hasFile: true, hasCover: false, coverExtension: null,
};
const manifest = {
  app: 'reader', backupFormatVersion: 1, exportedAt: '2026-09-27T00:00:00.000Z',
  schemaVersion: 19, books: [book],
};

test('accepts a compatible manifest and matching database rows', () => {
  const parsed = validation.parseBackupManifest(manifest, 19);
  validation.assertManifestMatchesDatabase(parsed, [{ id: book.id, file_hash: book.fileHash }]);
});

test('rejects path traversal, duplicate ids, and unrelated database rows', () => {
  for (const invalid of [
    { ...manifest, books: [{ ...book, id: '../Library/Books/other' }] },
    { ...manifest, books: [book, book] },
  ]) {
    assert.throws(() => validation.parseBackupManifest(invalid, 19),
      (error) => error.code === 'not-a-reader-backup');
  }
  assert.throws(() => validation.assertManifestMatchesDatabase(manifest, [
    { id: book.id, file_hash: 'b'.repeat(64) },
  ]), (error) => error.code === 'incomplete-backup');
});

test('rejects archives from a newer schema before any import mutation', () => {
  assert.throws(() => validation.parseBackupManifest({ ...manifest, schemaVersion: 20 }, 19),
    (error) => error.code === 'backup-from-newer-app');
});
