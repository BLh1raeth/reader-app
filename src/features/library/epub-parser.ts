import { XMLParser } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';

import type { ParsedEpub } from './library-types';

const parser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  processEntities: true,
  removeNSPrefix: true,
  textNodeName: '#text',
  trimValues: true,
});

type ManifestItem = { '@_href'?: string; '@_id'?: string; '@_media-type'?: string; '@_properties'?: string };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) return textValue((value as { '#text': unknown })['#text']);
  return null;
}

function directoryOf(path: string) {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash + 1);
}

function resolveZipPath(basePath: string, href: string) {
  const segments = `${directoryOf(basePath)}${href}`.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join('/');
}

function fileExtension(path: string) {
  const extension = path.split('?')[0].split('.').pop()?.toLowerCase();
  if (extension === 'jpeg') return 'jpg';
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : 'jpg';
}

function parseToc(xml: string, sourcePath: string): Array<{ href: string; label: string }> {
  const entries: Array<{ href: string; label: string }> = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(xml)) && entries.length < 500) {
    const label = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (label) entries.push({ href: resolveZipPath(sourcePath, match[1]), label });
  }
  return entries;
}

export function parseEpub(bytes: Uint8Array): ParsedEpub {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new Error('无法读取 EPUB 压缩内容。');
  }

  const containerBytes = archive['META-INF/container.xml'];
  if (!containerBytes) throw new Error('EPUB 缺少 META-INF/container.xml。');

  const container = parser.parse(strFromU8(containerBytes)) as { container?: { rootfiles?: { rootfile?: { '@_full-path'?: string } | Array<{ '@_full-path'?: string }> } } };
  const rootfile = asArray(container.container?.rootfiles?.rootfile)[0];
  const opfPath = rootfile?.['@_full-path'];
  if (!opfPath || !archive[opfPath]) throw new Error('EPUB 缺少 package 文档。');

  const packageDocument = parser.parse(strFromU8(archive[opfPath])) as {
    package?: {
      metadata?: Record<string, unknown>;
      manifest?: { item?: ManifestItem | ManifestItem[] };
      spine?: { '@_toc'?: string };
    };
  };
  const epubPackage = packageDocument.package;
  if (!epubPackage) throw new Error('EPUB package 文档无效。');

  const metadata = epubPackage.metadata ?? {};
  const title = textValue(asArray(metadata.title)[0]);
  const author = textValue(asArray(metadata.creator)[0]);
  const identifier = textValue(asArray(metadata.identifier)[0]);
  const language = textValue(asArray(metadata.language)[0]);
  const publisher = textValue(asArray(metadata.publisher)[0]);
  const manifestItems = asArray(epubPackage.manifest?.item);

  const coverMetadata = asArray(metadata.meta).find((item) => {
    const record = item as { '@_name'?: string; '@_content'?: string };
    return record['@_name'] === 'cover' && Boolean(record['@_content']);
  }) as { '@_content'?: string } | undefined;
  const coverItem = manifestItems.find((item) => item['@_id'] === coverMetadata?.['@_content'])
    ?? manifestItems.find((item) => item['@_properties']?.split(/\s+/).includes('cover-image'));
  const coverPath = coverItem?.['@_href'] ? resolveZipPath(opfPath, coverItem['@_href']) : null;
  const coverBytes = coverPath ? archive[coverPath] : null;

  const tocItem = manifestItems.find((item) => item['@_properties']?.split(/\s+/).includes('nav'))
    ?? manifestItems.find((item) => item['@_id'] === epubPackage.spine?.['@_toc'])
    ?? manifestItems.find((item) => item['@_media-type'] === 'application/x-dtbncx+xml');
  const tocPath = tocItem?.['@_href'] ? resolveZipPath(opfPath, tocItem['@_href']) : null;
  const toc = tocPath && archive[tocPath] ? parseToc(strFromU8(archive[tocPath]), tocPath) : [];

  return {
    title,
    author,
    identifier,
    language,
    publisher,
    toc,
    cover: coverBytes && coverPath ? { bytes: coverBytes, extension: fileExtension(coverPath) } : null,
    metadataJson: JSON.stringify({ identifier, language, publisher, opfPath }),
  };
}
