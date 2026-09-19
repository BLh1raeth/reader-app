import { inflateSync } from 'fflate';
import { File } from 'expo-file-system';
import { XMLParser } from 'fast-xml-parser';

import type { Book } from '../library/library-types';
import type { ReaderEpubSource, ReaderResourcePayload, ReaderZipEntry } from './reader-types';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_TAIL_MAX_BYTES = 22 + 0xffff + 20;
const RESOURCE_CACHE_MAX_BYTES = 6 * 1024 * 1024;
const RESOURCE_CACHE_ENTRY_MAX_BYTES = 1.5 * 1024 * 1024;
const BOOK_BYTES_CACHE_MAX_BYTES = 18 * 1024 * 1024;

type CachedResource = { base64: string; byteLength: number };
type CachedBookBytes = { bytes: Uint8Array; byteLength: number };

const resourceCache = new Map<string, CachedResource>();
const bookBytesCache = new Map<string, CachedBookBytes>();
let cachedBytes = 0;
let cachedBookBytes = 0;

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const step = 8192;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return globalThis.btoa(binary);
}

function readRange(bytes: Uint8Array, start: number, length: number) {
  if (start < 0 || length < 0 || start + length > bytes.length) throw new Error('EPUB ZIP 资源范围无效。');
  return bytes.subarray(start, start + length);
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (readUint32(bytes, offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('EPUB ZIP 缺少目录记录。');
}

function parseCentralDirectory(bytes: Uint8Array): ReaderZipEntry[] {
  const decoder = new TextDecoder('utf-8');
  const entries: ReaderZipEntry[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 46 > bytes.length || readUint32(bytes, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('EPUB ZIP 目录记录无效。');
    }
    const flags = readUint16(bytes, offset + 8);
    const compressionMethod = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localHeaderOffset = readUint32(bytes, offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (offset + recordLength > bytes.length) throw new Error('EPUB ZIP 目录长度无效。');
    if (flags & 0x1) throw new Error('暂不支持加密 EPUB。');
    if (compressionMethod !== 0 && compressionMethod !== 8) throw new Error('EPUB 使用了不支持的 ZIP 压缩方式。');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 EPUB。');
    }
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');
    if (name && !name.endsWith('/')) {
      entries.push({ name, compressedSize, compressionMethod: compressionMethod as 0 | 8, localHeaderOffset, uncompressedSize });
    }
    offset += recordLength;
  }
  // EOCD's count includes directory records while ReaderZipEntry intentionally
  // omits them. Reaching the exact end of the central directory is the useful
  // integrity check here; comparing those two counts rejects valid EPUBs.
  return entries;
}

function readZipDirectory(bytes: Uint8Array) {
  const tailLength = Math.min(bytes.length, ZIP_TAIL_MAX_BYTES);
  const tailStart = bytes.length - tailLength;
  const tail = readRange(bytes, tailStart, tailLength);
  const eocdOffset = findEndOfCentralDirectory(tail);
  const diskNumber = readUint16(tail, eocdOffset + 4);
  const centralDiskNumber = readUint16(tail, eocdOffset + 6);
  const centralDirectorySize = readUint32(tail, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(tail, eocdOffset + 16);
  if (diskNumber !== 0 || centralDiskNumber !== 0) throw new Error('暂不支持多磁盘 EPUB。');
  const centralDirectory = centralDirectoryOffset >= tailStart
    && centralDirectoryOffset + centralDirectorySize <= bytes.length
    ? tail.subarray(centralDirectoryOffset - tailStart, centralDirectoryOffset - tailStart + centralDirectorySize)
    : readRange(bytes, centralDirectoryOffset, centralDirectorySize);
  return parseCentralDirectory(centralDirectory);
}

function cacheKey(bookId: string, entryName: string) {
  return `${bookId}:${entryName}`;
}

function rememberResource(key: string, value: CachedResource) {
  if (value.byteLength > RESOURCE_CACHE_ENTRY_MAX_BYTES) return;
  const existing = resourceCache.get(key);
  if (existing) cachedBytes -= existing.byteLength;
  resourceCache.set(key, value);
  cachedBytes += value.byteLength;
  while (cachedBytes > RESOURCE_CACHE_MAX_BYTES && resourceCache.size > 0) {
    const oldest = resourceCache.entries().next().value as [string, CachedResource] | undefined;
    if (!oldest) break;
    resourceCache.delete(oldest[0]);
    cachedBytes -= oldest[1].byteLength;
  }
}

function rememberBookBytes(bookId: string, bytes: Uint8Array) {
  const existing = bookBytesCache.get(bookId);
  if (existing) cachedBookBytes -= existing.byteLength;
  bookBytesCache.set(bookId, { bytes, byteLength: bytes.length });
  cachedBookBytes += bytes.length;
  while (cachedBookBytes > BOOK_BYTES_CACHE_MAX_BYTES && bookBytesCache.size > 1) {
    const oldest = bookBytesCache.entries().next().value as [string, CachedBookBytes] | undefined;
    if (!oldest) break;
    bookBytesCache.delete(oldest[0]);
    cachedBookBytes -= oldest[1].byteLength;
  }
}

async function getBookBytes(book: Book) {
  const cached = bookBytesCache.get(book.id);
  if (cached) {
    bookBytesCache.delete(book.id);
    bookBytesCache.set(book.id, cached);
    return cached.bytes;
  }
  const file = new File(book.fileUri);
  const bytes = await file.bytes();
  rememberBookBytes(book.id, bytes);
  return bytes;
}

async function fullBase64Source(book: Book, startedAt: number): Promise<ReaderEpubSource> {
  const file = new File(book.fileUri);
  const base64 = await file.base64();
  return {
    bookId: book.id,
    sessionId: `${book.id}:${Date.now()}`,
    fileName: `${book.id}.epub`,
    byteLength: file.size,
    base64,
    sourceKind: 'full-base64-fallback',
    sourceReadMs: Date.now() - startedAt,
  };
}

/** Creates a ZIP index only; EPUB body data remains in app-private storage. */
export async function createReaderEpubSource(book: Book): Promise<ReaderEpubSource> {
  const file = new File(book.fileUri);
  if (!file.exists) throw new Error('这本书的 EPUB 文件已不存在。');
  const startedAt = Date.now();
  try {
    // File.slice() constructs a Blob in this SDK, and that Blob cannot be created
    // from an ArrayBuffer on the current iOS runtime. Read once through File.bytes()
    // and retain a bounded native-side byte cache for fast repeat opens instead.
    const bytes = await getBookBytes(book);
    const entries = readZipDirectory(bytes);
    if (!entries.some((entry) => entry.name === 'META-INF/container.xml')) throw new Error('EPUB 缺少 container.xml。');
    // Bytes are already in memory here; resolving the few metadata files
    // foliate needs at open time costs microseconds and removes several
    // serial DOM<->native round trips from the critical path.
    const prefetchedText = prefetchOpenMetadata(bytes, entries);
    return {
      bookId: book.id,
      sessionId: `${book.id}:${Date.now()}`,
      fileName: `${book.id}.epub`,
      byteLength: file.size,
      entries,
      prefetchedText,
      sourceKind: 'zip-resource-loader',
      sourceReadMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.warn('[READER_RESOURCE]', 'ZIP 索引不可用，使用兼容模式。', error);
    return fullBase64Source(book, startedAt);
  }
}

/** Compatibility fallback used only after the on-demand loader fails. */
export async function createFullEpubSource(book: Book): Promise<ReaderEpubSource> {
  const file = new File(book.fileUri);
  if (!file.exists) throw new Error('这本书的 EPUB 文件已不存在。');
  return fullBase64Source(book, Date.now());
}

/** Native-side random access for one ZIP entry. DOM receives only this resource. */
export async function readReaderEpubResource(
  book: Book,
  source: ReaderEpubSource,
  name: string,
): Promise<ReaderResourcePayload | null> {
  if (source.sourceKind !== 'zip-resource-loader') return null;
  const entry = source.entries?.find((candidate) => candidate.name === name);
  if (!entry) return null;
  const key = cacheKey(book.id, name);
  const cached = resourceCache.get(key);
  if (cached) {
    resourceCache.delete(key);
    resourceCache.set(key, cached);
    return { base64: cached.base64 };
  }
  const bytes = await getBookBytes(book);
  const decoded = extractEntryBytes(bytes, entry);
  const value = { base64: bytesToBase64(decoded), byteLength: decoded.length };
  rememberResource(key, value);
  return { base64: value.base64 };
}

function extractEntryBytes(allBytes: Uint8Array, entry: ReaderZipEntry): Uint8Array {
  const localHeader = readRange(allBytes, entry.localHeaderOffset, 30);
  if (readUint32(localHeader, 0) !== LOCAL_FILE_SIGNATURE) throw new Error(`EPUB 资源头无效：${entry.name}`);
  const nameLength = readUint16(localHeader, 26);
  const extraLength = readUint16(localHeader, 28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = readRange(allBytes, dataOffset, entry.compressedSize);
  const decoded = entry.compressionMethod === 0 ? compressed : inflateSync(compressed);
  if (entry.uncompressedSize !== 0 && decoded.length !== entry.uncompressedSize) throw new Error(`EPUB 资源大小不匹配：${entry.name}`);
  return decoded;
}

const metadataXmlParser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  processEntities: true,
  removeNSPrefix: true,
  textNodeName: '#text',
  trimValues: true,
});

function metadataAsArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Mirrors foliate-js's resolveURL so prefetched keys match the exact names
 * foliate requests. Any mismatch is harmless: the DOM side falls back to a
 * bridge request for names missing from the prefetch map.
 */
function resolveFoliateHref(href: string, relativeTo: string): string {
  const withoutFragment = href.split('#', 1)[0] ?? '';
  const withoutQuery = withoutFragment.split('?', 1)[0] ?? '';
  const normalized = withoutQuery.replace(/%2c/, ',');
  const baseDir = relativeTo.includes('/') ? relativeTo.slice(0, relativeTo.lastIndexOf('/') + 1) : '';
  const absolute = normalized.startsWith('/') ? normalized.slice(1) : baseDir + normalized;
  const parts: string[] = [];
  for (const segment of absolute.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  const joined = parts.join('/');
  try {
    return decodeURI(joined);
  } catch {
    return joined;
  }
}

/**
 * Reads the small metadata files foliate needs to open a book (container.xml,
 * the OPF package document, encryption.xml, and the NCX/EPUB3 nav) from the
 * already-loaded bytes. They ride along with the source so the DOM side can
 * answer foliate's opening requests without DOM<->native bridge round trips.
 * Selection mirrors foliate's own init sequence; anything we fail to resolve
 * simply falls back to on-demand bridge requests.
 */
function prefetchOpenMetadata(allBytes: Uint8Array, entries: ReaderZipEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  const textDecoder = new TextDecoder('utf-8');
  const readText = (name: string): string | null => {
    const entry = entryMap.get(name);
    if (!entry) return null;
    try {
      return textDecoder.decode(extractEntryBytes(allBytes, entry));
    } catch {
      return null;
    }
  };
  const containerXml = readText('META-INF/container.xml');
  if (containerXml == null) return out;
  out['META-INF/container.xml'] = containerXml;
  let opfPath: string | null = null;
  try {
    const parsed = metadataXmlParser.parse(containerXml) as {
      container?: { rootfiles?: { rootfile?: unknown } };
    };
    const candidates = metadataAsArray(parsed?.container?.rootfiles?.rootfile)
      .map((rootfile) => {
        const record = rootfile as { '@_full-path'?: unknown; '@_media-type'?: unknown } | null;
        return {
          fullPath: typeof record?.['@_full-path'] === 'string' ? record['@_full-path'] : null,
          mediaType: typeof record?.['@_media-type'] === 'string' ? record['@_media-type'] : null,
        };
      })
      .filter((candidate) => candidate.fullPath);
    opfPath = candidates.find((candidate) => candidate.mediaType === 'application/oebps-package+xml')?.fullPath
      ?? candidates[0]?.fullPath
      ?? null;
  } catch {
    opfPath = null;
  }
  if (!opfPath) return out;
  const opfXml = readText(opfPath);
  if (opfXml == null) return out;
  out[opfPath] = opfXml;
  // foliate always asks for encryption.xml; prefetching '' when it is absent
  // skips a bridge round trip that is guaranteed to miss.
  out['META-INF/encryption.xml'] = readText('META-INF/encryption.xml') ?? '';
  try {
    const parsed = metadataXmlParser.parse(opfXml) as {
      package?: { manifest?: { item?: unknown }; spine?: { '@_toc'?: unknown } };
    };
    const manifest = metadataAsArray(parsed?.package?.manifest?.item)
      .map((item) => {
        const record = item as {
          '@_href'?: unknown; '@_id'?: unknown; '@_media-type'?: unknown; '@_properties'?: unknown;
        } | null;
        return {
          id: typeof record?.['@_id'] === 'string' ? record['@_id'] : null,
          href: typeof record?.['@_href'] === 'string' ? record['@_href'] : null,
          mediaType: typeof record?.['@_media-type'] === 'string' ? record['@_media-type'] : null,
          properties: typeof record?.['@_properties'] === 'string' ? record['@_properties'].split(/\s+/) : [],
        };
      })
      .filter((item) => item.href);
    const spineToc = parsed?.package?.spine?.['@_toc'];
    const navHref = manifest.find((item) => item.properties.includes('nav'))?.href;
    const ncxHref = manifest.find((item) => item.id != null && item.id === spineToc)?.href
      ?? manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml')?.href;
    for (const href of [navHref, ncxHref]) {
      if (!href) continue;
      const name = resolveFoliateHref(href, opfPath);
      const text = readText(name);
      if (text != null) out[name] = text;
    }
  } catch {
    // TOC metadata falls back to on-demand bridge requests.
  }
  return out;
}
