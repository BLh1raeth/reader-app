import { inflateSync } from 'fflate';
import { File } from 'expo-file-system';

import type { Book } from '../library/library-types';
import type { ReaderEpubSource, ReaderResourcePayload, ReaderZipEntry } from './reader-types';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_TAIL_MAX_BYTES = 22 + 0xffff + 20;
const RESOURCE_CACHE_MAX_BYTES = 6 * 1024 * 1024;
const RESOURCE_CACHE_ENTRY_MAX_BYTES = 1.5 * 1024 * 1024;

type CachedResource = { base64: string; byteLength: number };

const resourceCache = new Map<string, CachedResource>();
let cachedBytes = 0;

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

async function readRange(file: File, start: number, length: number) {
  if (start < 0 || length < 0 || start + length > file.size) throw new Error('EPUB ZIP 资源范围无效。');
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (readUint32(bytes, offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('EPUB ZIP 缺少目录记录。');
}

function parseCentralDirectory(bytes: Uint8Array, expectedEntryCount: number): ReaderZipEntry[] {
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
  if (expectedEntryCount !== 0 && entries.length !== expectedEntryCount) throw new Error('EPUB ZIP 目录条目数不一致。');
  return entries;
}

async function readZipDirectory(file: File) {
  const tailLength = Math.min(file.size, ZIP_TAIL_MAX_BYTES);
  const tailStart = file.size - tailLength;
  const tail = await readRange(file, tailStart, tailLength);
  const eocdOffset = findEndOfCentralDirectory(tail);
  const diskNumber = readUint16(tail, eocdOffset + 4);
  const centralDiskNumber = readUint16(tail, eocdOffset + 6);
  const entryCount = readUint16(tail, eocdOffset + 10);
  const centralDirectorySize = readUint32(tail, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(tail, eocdOffset + 16);
  if (diskNumber !== 0 || centralDiskNumber !== 0) throw new Error('暂不支持多磁盘 EPUB。');
  const centralDirectory = centralDirectoryOffset >= tailStart
    && centralDirectoryOffset + centralDirectorySize <= file.size
    ? tail.subarray(centralDirectoryOffset - tailStart, centralDirectoryOffset - tailStart + centralDirectorySize)
    : await readRange(file, centralDirectoryOffset, centralDirectorySize);
  return parseCentralDirectory(centralDirectory, entryCount);
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

async function fullBase64Source(book: Book, startedAt: number): Promise<ReaderEpubSource> {
  const file = new File(book.fileUri);
  const base64 = await file.base64();
  return {
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
    const entries = await readZipDirectory(file);
    if (!entries.some((entry) => entry.name === 'META-INF/container.xml')) throw new Error('EPUB 缺少 container.xml。');
    return {
      sessionId: `${book.id}:${Date.now()}`,
      fileName: `${book.id}.epub`,
      byteLength: file.size,
      entries,
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
  const startedAt = Date.now();
  const key = cacheKey(book.id, name);
  const cached = resourceCache.get(key);
  if (cached) {
    resourceCache.delete(key);
    resourceCache.set(key, cached);
    return { ...cached, cacheHit: true, readMs: Date.now() - startedAt };
  }
  const file = new File(book.fileUri);
  const localHeader = await readRange(file, entry.localHeaderOffset, 30);
  if (readUint32(localHeader, 0) !== LOCAL_FILE_SIGNATURE) throw new Error(`EPUB 资源头无效：${name}`);
  const nameLength = readUint16(localHeader, 26);
  const extraLength = readUint16(localHeader, 28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = await readRange(file, dataOffset, entry.compressedSize);
  const bytes = entry.compressionMethod === 0 ? compressed : inflateSync(compressed);
  if (entry.uncompressedSize !== 0 && bytes.length !== entry.uncompressedSize) throw new Error(`EPUB 资源大小不匹配：${name}`);
  const value = { base64: bytesToBase64(bytes), byteLength: bytes.length };
  rememberResource(key, value);
  return { ...value, cacheHit: false, readMs: Date.now() - startedAt };
}
