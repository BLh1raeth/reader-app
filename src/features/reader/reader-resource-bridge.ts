import { File } from 'expo-file-system';
import { XMLParser } from 'fast-xml-parser';

import { byteSource, EPUB_LIMITS, extractZipEntry, readZipDirectory, ZipValidationError, type ZipSource } from '../../shared/epub/zip';

import type { Book } from '../library/library-types';
import type { ReaderEpubSource, ReaderResourcePayload, ReaderZipEntry } from './reader-types';

const RESOURCE_CACHE_MAX_BYTES = 6 * 1024 * 1024;
const RESOURCE_CACHE_ENTRY_MAX_BYTES = 1.5 * 1024 * 1024;
type CachedResource = { base64: string; byteLength: number };
const resourceCache = new Map<string, CachedResource>();
let cachedBytes = 0;

export function clearReaderResourceCache() {
  resourceCache.clear();
  cachedBytes = 0;
}

function withBookSource<T>(book: Book, read: (source: ZipSource) => T): T {
  const file = new File(book.fileUri);
  if (file.size > EPUB_LIMITS.file) throw new ZipValidationError('EPUB 文件超过 256 MB。');
  const handle = file.open();
  try {
    return read({ size: file.size, read: (start, length) => {
      handle.offset = start;
      return handle.readBytes(length);
    } });
  } finally {
    handle.close();
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const step = 8192;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return globalThis.btoa(binary);
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
  if (file.size > EPUB_LIMITS.file) throw new ZipValidationError('EPUB 文件超过 256 MB。');
  // Compatibility mode cannot bypass ZIP size/path validation.
  const bytes = await file.bytes();
  readZipDirectory(byteSource(bytes));
  const base64 = bytesToBase64(bytes);
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
    const { entries, prefetchedText } = withBookSource(book, (source) => {
      const entries = readZipDirectory(source);
      if (!entries.some((entry) => entry.name === 'META-INF/container.xml')) {
        throw new ZipValidationError('EPUB 缺少 container.xml。');
      }
      return { entries, prefetchedText: prefetchOpenMetadata(source, entries) };
    });
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
    if (error instanceof ZipValidationError) throw error;
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
  const key = JSON.stringify([book.id, book.fileHash, book.fileUri, name]);
  const cached = resourceCache.get(key);
  if (cached) {
    resourceCache.delete(key);
    resourceCache.set(key, cached);
    return { base64: cached.base64 };
  }
  const decoded = withBookSource(book, (zip) => extractZipEntry(zip, entry));
  const value = { base64: bytesToBase64(decoded), byteLength: decoded.length };
  rememberResource(key, value);
  return { base64: value.base64 };
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
 * ZIP file through range reads. They ride along with the source so the DOM side can
 * answer foliate's opening requests without DOM<->native bridge round trips.
 * Selection mirrors foliate's own init sequence; anything we fail to resolve
 * simply falls back to on-demand bridge requests.
 */
function prefetchOpenMetadata(source: ZipSource, entries: ReaderZipEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  const textDecoder = new TextDecoder('utf-8');
  const readText = (name: string): string | null => {
    const entry = entryMap.get(name);
    if (!entry) return null;
    try {
      return textDecoder.decode(extractZipEntry(source, entry));
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
