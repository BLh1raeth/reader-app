import { EPUB } from 'foliate-js/epub.js';
import { makeBook } from 'foliate-js/view.js';
import { base64ToBytes, normalizeBookStyles, type FoliateBook } from './foliate-utils';
import { protectEpubContent } from './epub-content-policy';
import type { ReaderZipEntry, ReaderResourcePayload } from '../reader-types';
import type { ReaderPageCountCache } from '../reader-page-cache-repository';
import type { ReaderSettings } from '../reader-settings';

export type FoliateOpenInput = {
  bookId: string;
  base64?: string;
  entries?: ReaderZipEntry[];
  fileName: string;
  onResourceRequest: (name: string) => Promise<ReaderResourcePayload | null>;
  /** Metadata texts prefetched natively; checked before any bridge request. */
  prefetchedText?: Record<string, string>;
  restoreCfi: string | null;
  /**
   * Excerpts Tab Core C: external navigation target (e.g. an excerpt's range
   * CFI from its Source row). When set and resolvable it becomes the initial
   * navigation intent, winning over restoreCfi; when unresolvable the reader
   * falls back to restoreCfi and reports EXTERNAL_TARGET_RESULT.
   */
  externalTargetCfi?: string | null;
  sourceKind: 'zip-resource-loader' | 'full-base64-fallback';
  pageCountCache: ReaderPageCountCache | null;
  readerSettings: ReaderSettings;
};

async function createOnDemandBook(
  input: FoliateOpenInput,
): Promise<FoliateBook> {
  const entries = new Map((input.entries ?? []).map((entry) => [entry.name, entry]));
  const decoder = new TextDecoder();
  const prefetchedText = input.prefetchedText ?? {};
  const loadBytes = async (name: string) => {
    const resource = await input.onResourceRequest(name);
    if (!resource) return null;
    return base64ToBytes(resource.base64);
  };
  return new EPUB({
    loadText: async (name: string) => {
      // Opening metadata (container.xml, OPF, encryption.xml, NCX/nav) was
      // read natively alongside the source: answer straight from memory
      // instead of paying a DOM<->native round trip per file.
      const hit = prefetchedText[name];
      if (hit !== undefined) return hit;
      const bytes = await loadBytes(name);
      return bytes ? decoder.decode(bytes) : '';
    },
    loadBlob: async (name: string) => (await loadBytes(name)) ?? new Uint8Array(),
    getSize: (name: string) => entries.get(name)?.uncompressedSize ?? 0,
  }).init() as Promise<FoliateBook>;
}


export async function createFoliateBook(input: FoliateOpenInput): Promise<FoliateBook> {
  const book = input.sourceKind === 'zip-resource-loader'
    ? await createOnDemandBook(input)
    : await makeBook(new File([base64ToBytes(input.base64 ?? '')], input.fileName,
      { type: 'application/epub+zip' })) as FoliateBook;
  protectEpubContent(book);
  normalizeBookStyles(book);
  return book;
}
