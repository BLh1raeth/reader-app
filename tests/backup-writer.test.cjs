const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');
const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const { createFileSystemMock } = require('./helpers/file-system-fixture.cjs');
function fixture() {
  const fs = createFileSystemMock();
  const load = createTypeScriptLoader({ 'expo-file-system': fs });
  return { fs, write: load(path.join(__dirname, '../src/features/library/backup-writer.ts')).writeBackupArchive };
}

test('streamed backup round trips without reading whole book files into memory', async () => {
  const { fs, write } = fixture();
  const book = new fs.File('file:///docs/book.epub');
  const expected = new Uint8Array(768 * 1024 + 17).fill(91); book.write(expected);
  book.arrayBuffer = book.bytes = () => { throw new Error('whole-file read is forbidden'); };
  const output = new fs.File('file:///cache/backup.zip');
  const progress = []; let largestRead = 0;
  const open = book.open.bind(book); book.open = () => {
    const handle = open(); const read = handle.readBytes;
    handle.readBytes = (length) => { largestRead = Math.max(largestRead, length); return read(length); };
    return handle;
  };
  await write(output, [{ name: 'books/one.epub', data: book }, { name: 'manifest.json', data: new TextEncoder().encode('{}') }], { onProgress: (fraction) => progress.push(fraction) });
  const archive = await JSZip.loadAsync(fs.files.get(output.uri), { checkCRC32: true });
  assert.deepEqual(await archive.file('books/one.epub').async('uint8array'), expected);
  assert.equal(await archive.file('manifest.json').async('string'), '{}');
  assert.equal(largestRead, 256 * 1024);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, i) => !i || value >= progress[i - 1]));
});

test('canceling an in-progress backup removes only the partial output', async () => {
  const { fs, write } = fixture(); const controller = new AbortController();
  const book = new fs.File('file:///docs/book.epub'); book.write(new Uint8Array(1024 * 1024));
  const output = new fs.File('file:///cache/backup.zip');
  await assert.rejects(write(output, [{ name: 'book.epub', data: book }], {
    signal: controller.signal, onProgress: () => controller.abort(),
  }), /取消/);
  assert.equal(output.exists, false); assert.equal(book.exists, true);
});

test('filesystem write failures remove partial output and preserve source files', async () => {
  const { fs, write } = fixture(); const book = new fs.File('file:///docs/book.epub'); book.write(Uint8Array.of(1, 2));
  const output = new fs.File('file:///cache/backup.zip');
  const open = output.open.bind(output); output.open = () => {
    const handle = open(); handle.writeBytes = () => { throw new Error('disk full'); }; return handle;
  };
  await assert.rejects(write(output, [{ name: 'book.epub', data: book }]), /disk full/);
  assert.equal(output.exists, false); assert.equal(book.exists, true);
});
