import { File } from 'expo-file-system';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

import type { Book } from '../library/library-types';

type ManifestItem = {
  '@_id'?: string;
  '@_href'?: string;
  '@_media-type'?: string;
  '@_properties'?: string;
};

type SpineItem = { '@_idref'?: string; '@_linear'?: string };

export type ReaderBlock = {
  id: string;
  kind: 'heading' | 'paragraph' | 'quote' | 'image';
  text?: string;
  runs?: Array<{ text: string; bold?: boolean; italic?: boolean }>;
  level?: number;
  imageUri?: string;
};

export type ReaderChapter = {
  spineIndex: number;
  title: string | null;
  blocks: ReaderBlock[];
};

export type ReaderBook = {
  spineLength: number;
  loadChapter: (spineIndex: number) => ReaderChapter;
};

const xmlParser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  removeNSPrefix: true,
  textNodeName: '#text',
  trimValues: true,
});

function asArray<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function directoryOf(path: string) {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? '' : path.slice(0, separator + 1);
}

function resolveArchivePath(basePath: string, href: string) {
  const segments = `${directoryOf(basePath)}${href.split('#')[0].split('?')[0]}`.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join('/');
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/&(?:lt|#60);/gi, '<')
    .replace(/&(?:gt|#62);/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, character: string) => {
      const code = character.startsWith('x') ? Number.parseInt(character.slice(1), 16) : Number.parseInt(character, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function textFromMarkup(markup: string) {
  return decodeEntities(
    markup
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/[\t\r ]+/g, ' ')
      .trim(),
  );
}

function inlineRuns(markup: string) {
  const runs: Array<{ text: string; bold?: boolean; italic?: boolean }> = [];
  const active = { bold: false, italic: false };
  const tokens = markup.split(/(<\/?(?:strong|b|em|i)\b[^>]*>)/gi);
  for (const token of tokens) {
    const tag = token.match(/^<\/?(strong|b|em|i)\b[^>]*>$/i)?.[1]?.toLowerCase();
    if (tag) {
      const closing = /^<\//.test(token);
      if (tag === 'strong' || tag === 'b') active.bold = !closing;
      else active.italic = !closing;
      continue;
    }
    const text = textFromMarkup(token);
    if (text) runs.push({ text, ...(active.bold ? { bold: true } : {}), ...(active.italic ? { italic: true } : {}) });
  }
  return runs;
}

function extensionForMediaType(mediaType: string | undefined, path: string) {
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/gif') return 'gif';
  if (mediaType === 'image/webp') return 'webp';
  if (mediaType === 'image/svg+xml') return 'svg+xml';
  if (mediaType === 'image/jpeg') return 'jpeg';
  return path.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpeg';
}

function base64FromBytes(bytes: Uint8Array) {
  let binary = '';
  const step = 8192;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return globalThis.btoa(binary);
}

function imageDataUri(bytes: Uint8Array, mediaType: string | undefined, path: string) {
  // Keep a malformed or unusually large image from turning a normal book into
  // an out-of-memory condition. The rest of the chapter remains readable.
  if (bytes.length > 2 * 1024 * 1024 || mediaType === 'image/svg+xml') return null;
  const type = mediaType ?? `image/${extensionForMediaType(mediaType, path)}`;
  return `data:${type};base64,${base64FromBytes(bytes)}`;
}

function titleFromChapter(markup: string) {
  const match = markup.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? markup.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? textFromMarkup(match[1]) || null : null;
}

function blocksFromChapter(
  markup: string,
  chapterPath: string,
  archive: Record<string, Uint8Array>,
  manifestByPath: Map<string, ManifestItem>,
): ReaderBlock[] {
  const body = markup.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? markup;
  const sanitized = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<!--([\s\S]*?)-->/g, '');
  const blocks: ReaderBlock[] = [];
  const pattern = /<(h[1-6]|p|blockquote|li|pre|img)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<img\b([^>]*)\/?\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sanitized))) {
    const tag = (match[1] ?? 'img').toLowerCase();
    const attributes = match[2] ?? match[4] ?? '';
    if (tag === 'img') {
      const source = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!source) continue;
      const resourcePath = resolveArchivePath(chapterPath, source);
      const resource = archive[resourcePath];
      const manifestItem = manifestByPath.get(resourcePath);
      const uri = resource ? imageDataUri(resource, manifestItem?.['@_media-type'], resourcePath) : null;
      if (uri) blocks.push({ id: `block-${blocks.length}`, kind: 'image', imageUri: uri });
      continue;
    }
    const markup = match[3] ?? '';
    const text = textFromMarkup(markup);
    if (!text) continue;
    blocks.push({
      id: `block-${blocks.length}`,
      kind: tag.startsWith('h') ? 'heading' : tag === 'blockquote' ? 'quote' : 'paragraph',
      level: tag.startsWith('h') ? Number.parseInt(tag.slice(1), 10) : undefined,
      text,
      runs: inlineRuns(markup),
    });
  }
  if (blocks.length > 0) return blocks;

  const text = textFromMarkup(sanitized);
  return text ? [{ id: 'block-0', kind: 'paragraph', text }] : [];
}

export async function openEpubForReading(book: Book): Promise<ReaderBook> {
  const file = new File(book.fileUri);
  if (!file.exists) throw new Error('这本书的本地文件已不存在。');

  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(await file.bytes());
  } catch {
    throw new Error('无法读取这本 EPUB。');
  }

  const container = archive['META-INF/container.xml'];
  if (!container) throw new Error('EPUB 缺少 container.xml。');
  const containerDocument = xmlParser.parse(strFromU8(container)) as { container?: { rootfiles?: { rootfile?: { '@_full-path'?: string } | Array<{ '@_full-path'?: string }> } } };
  const opfPath = asArray(containerDocument.container?.rootfiles?.rootfile)[0]?.['@_full-path'];
  if (!opfPath || !archive[opfPath]) throw new Error('EPUB 缺少 package 文档。');

  const opf = xmlParser.parse(strFromU8(archive[opfPath])) as {
    package?: { manifest?: { item?: ManifestItem | ManifestItem[] }; spine?: { itemref?: SpineItem | SpineItem[] } };
  };
  const manifest = asArray(opf.package?.manifest?.item);
  const manifestById = new Map(manifest.flatMap((item) => (item['@_id'] && item['@_href'] ? [[item['@_id'], item] as const] : [])));
  const manifestByPath = new Map(manifest.flatMap((item) => (item['@_href'] ? [[resolveArchivePath(opfPath, item['@_href']), item] as const] : [])));
  const spinePaths = asArray(opf.package?.spine?.itemref)
    .filter((item) => item['@_linear'] !== 'no')
    .map((item) => manifestById.get(item['@_idref'] ?? ''))
    .filter((item): item is ManifestItem & { '@_href': string } => Boolean(item?.['@_href']))
    .map((item) => resolveArchivePath(opfPath, item['@_href']));

  if (spinePaths.length === 0) throw new Error('EPUB 没有可阅读的章节。');

  return {
    spineLength: spinePaths.length,
    loadChapter(spineIndex) {
      const safeIndex = Math.max(0, Math.min(spineIndex, spinePaths.length - 1));
      const chapterPath = spinePaths[safeIndex];
      const bytes = archive[chapterPath];
      if (!bytes) throw new Error('这一章节的内容缺失。');
      const markup = strFromU8(bytes);
      return {
        spineIndex: safeIndex,
        title: titleFromChapter(markup),
        blocks: blocksFromChapter(markup, chapterPath, archive, manifestByPath),
      };
    },
  };
}
