const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { zipSync, strToU8 } = require('fflate');
const { createTypeScriptLoader } = require('./helpers/load-typescript.cjs');
const load = createTypeScriptLoader();
const { byteSource, readZipDirectory, extractZipEntry, ZipValidationError, EPUB_LIMITS } = load(path.join(__dirname, '../src/shared/epub/zip.ts'));

function central(bytes) { return Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); }
function fixture() {
  return {
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>'),
    'OEBPS/book.opf': strToU8('<package><metadata><title>测试</title><creator>作者</creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>'),
    'OEBPS/toc.ncx': strToU8('<ncx><navMap><navPoint><navLabel><text>第一章</text></navLabel><content src="chapter.xhtml#first"/><navPoint><navLabel><text>小节</text></navLabel><content src="chapter.xhtml#second"/></navPoint></navPoint></navMap></ncx>'),
    'OEBPS/chapter.xhtml': strToU8('正文'.repeat(20000)),
  };
}

test('bounded ZIP decoding verifies size and CRC and rejects unsafe paths/quotas', () => {
  const zip = zipSync({ 'chapter.xhtml': strToU8('中文阅读'.repeat(2000)) });
  const entries = readZipDirectory(byteSource(zip));
  assert.equal(new TextDecoder().decode(extractZipEntry(byteSource(zip), entries[0])), '中文阅读'.repeat(2000));
  const badCRC = new Uint8Array(zip); badCRC[central(badCRC) + 16] ^= 1;
  assert.throws(() => extractZipEntry(byteSource(badCRC), readZipDirectory(byteSource(badCRC))[0]), /校验/);
  const liedSize = new Uint8Array(zip); new DataView(liedSize.buffer).setUint32(central(liedSize) + 24, 8, true);
  assert.throws(() => extractZipEntry(byteSource(liedSize), readZipDirectory(byteSource(liedSize))[0]), ZipValidationError);
  assert.throws(() => readZipDirectory(byteSource(zipSync({ '../escape': strToU8('x') }))), /路径/);
  assert.throws(() => readZipDirectory(byteSource(zip), { ...EPUB_LIMITS, entry: 100 }), /过大/);
  assert.throws(() => readZipDirectory(byteSource(zip.subarray(0, zip.length - 2))), /目录/);
});

test('import reads EPUB 2 NCX and metadata without decompressing chapters', () => {
  const { parseEpub } = load(path.join(__dirname, '../src/features/library/epub-parser.ts'));
  const zip = zipSync(fixture());
  const entry = readZipDirectory(byteSource(zip)).find((entry) => entry.name.endsWith('chapter.xhtml'));
  const view = new DataView(zip.buffer);
  const start = entry.localHeaderOffset + 30 + view.getUint16(entry.localHeaderOffset + 26, true) + view.getUint16(entry.localHeaderOffset + 28, true);
  zip[start] ^= 255; // A broken chapter must not be decoded during metadata import.
  const parsed = parseEpub(zip);
  assert.equal(parsed.title, '测试');
  assert.equal(parsed.author, '作者');
  assert.deepEqual(parsed.toc, [{ href: 'OEBPS/chapter.xhtml#first', label: '第一章' }, { href: 'OEBPS/chapter.xhtml#second', label: '小节' }]);
  assert.throws(() => extractZipEntry(byteSource(zip), entry), ZipValidationError);
  const missing = fixture(); delete missing['OEBPS/chapter.xhtml'];
  assert.throws(() => parseEpub(zipSync(missing)), /正文资源/);
});

test('incremental file hash agrees with SHA-256 across chunk boundaries and yields to the event loop', async () => {
  const { hashEpub } = load(path.join(__dirname, '../src/shared/epub/hash.ts'));
  const bytes = crypto.randomBytes(768 * 1024 + 13);
  let yielded = false; setTimeout(() => { yielded = true; }, 0);
  assert.equal(await hashEpub(bytes), crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(yielded, true);
  assert.equal(await hashEpub(new Uint8Array()), crypto.createHash('sha256').digest('hex'));
});

test('valid URI-encoded package, chapter and cover paths resolve without treating fragments as filenames', () => {
  const { parseEpub } = load(path.join(__dirname, '../src/features/library/epub-parser.ts'));
  const files = fixture();
  files['META-INF/container.xml'] = strToU8('<container><rootfiles><rootfile full-path="OEBPS/book%20name.opf"/></rootfiles></container>');
  files['OEBPS/book name.opf'] = strToU8(new TextDecoder().decode(files['OEBPS/book.opf'])
    .replace('href="chapter.xhtml"', 'href="chapter%20one.xhtml#first"')
    .replace('</manifest>', '<item id="cover" href="cover%20image.png" properties="cover-image"/></manifest>'));
  delete files['OEBPS/book.opf'];
  files['OEBPS/chapter one.xhtml'] = files['OEBPS/chapter.xhtml']; delete files['OEBPS/chapter.xhtml'];
  files['OEBPS/cover image.png'] = Uint8Array.of(1, 2, 3);
  const parsed = parseEpub(zipSync(files));
  assert.equal(parsed.title, '测试'); assert.deepEqual(parsed.cover.bytes, Uint8Array.of(1, 2, 3));
});
