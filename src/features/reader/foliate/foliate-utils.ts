import type { ReaderTocItem } from '../reader-types';

// foliate-js structural shapes needed by the DOM/text/paint utilities.
export type FoliateResolvedHref = {
  index?: number;
  anchor?: (doc: Document) => Range | Element | number | null;
} | null | undefined;

export type FoliateBook = {
  transformTarget?: EventTarget;
};

export type DocPoint = { node: Node; offset: number };

// SVG overlayer paint colors for highlights / search / excerpt reveals.
const HIGHLIGHT_FILL = '#0A84FF';
const HIGHLIGHT_OPACITY = '0.28';
const REVEAL_FILL = '#FFD60A';
const REVEAL_OPACITY = '0.25';

export function anchorToDocPoint(anchor: unknown, doc: Document): DocPoint | null {
  if (!anchor || typeof anchor === 'number') return null;
  const asRange = anchor as Partial<Range>;
  if (typeof asRange.startContainer !== 'undefined' && typeof asRange.collapse === 'function') {
    const range = asRange as Range;
    return { node: range.startContainer, offset: range.startOffset };
  }
  const asElement = anchor as Partial<Element>;
  if (asElement.nodeType === 1) {
    const range = doc.createRange();
    range.selectNode(asElement as Element);
    range.collapse(true);
    return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

export function rangeReadableText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll('script, style, noscript').forEach((element) => element.remove());
  return fragment.textContent ?? '';
}

/**
 * Count readable characters: Unicode grapheme clusters (Intl.Segmenter with
 * a surrogate-pair-aware code-point fallback), whitespace excluded, CJK /
 * letters / digits / punctuation kept. No new dependencies.
 */
export function countReadableCharacters(text: string): number {
  const stripped = text.replace(/\s+/gu, '');
  if (!stripped) return 0;
  const segmenterCtor = (Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity?: string },
    ) => { segment(input: string): Iterable<unknown> };
  }).Segmenter;
  if (typeof segmenterCtor === 'function') {
    try {
      const segmenter = new segmenterCtor(undefined, { granularity: 'grapheme' });
      let count = 0;
      for (const _segment of segmenter.segment(stripped)) count += 1;
      return count;
    } catch {
      // Fall through to the code-point fallback below.
    }
  }
  return Array.from(stripped).length;
}

export function base64ToBytes(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function cssText(value: unknown): Promise<string> {
  const resolved = await value;
  if (typeof resolved === 'string') return resolved;
  if (resolved instanceof Blob) return resolved.text();
  if (resolved instanceof ArrayBuffer) return new TextDecoder().decode(resolved);
  if (ArrayBuffer.isView(resolved)) {
    return new TextDecoder().decode(new Uint8Array(resolved.buffer, resolved.byteOffset, resolved.byteLength));
  }
  return resolved == null ? '' : String(resolved);
}

export function normalizeBookStyles(book: FoliateBook) {
  // A few real-world EPUBs expose stylesheet bytes/Blobs through their
  // manifest. foliate's paginator expects CSS to be a string and otherwise
  // calls `.replace()` on that value. Register before `view.open()` so this
  // narrow compatibility normalizer runs before the paginator listener.
  book.transformTarget?.addEventListener('data', (event) => {
    const dataEvent = event as CustomEvent<{ type?: unknown; data?: unknown }>;
    if (dataEvent.detail.type === 'text/css') dataEvent.detail.data = cssText(dataEvent.detail.data);
  });
}

export function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function mapToc(items: unknown, resolveHref?: (href: string) => FoliateResolvedHref): ReaderTocItem[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item): ReaderTocItem[] => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as { id?: unknown; label?: unknown; href?: unknown; subitems?: unknown };
    if (typeof candidate.label !== 'string' || typeof candidate.href !== 'string') return [];
    let resolved: FoliateResolvedHref;
    try {
      resolved = resolveHref?.(candidate.href);
    } catch {
      resolved = null;
    }
    const subitems = mapToc(candidate.subitems, resolveHref);
    return [{
      id: typeof candidate.id === 'number' ? candidate.id : null,
      label: candidate.label,
      href: candidate.href,
      spineIndex: typeof resolved?.index === 'number' && resolved.index >= 0 ? resolved.index : null,
      ...(subitems.length ? { subitems } : {}),
    }];
  });
}

export function drawSearchResultHighlight(rects: Array<{ left: number; top: number; width: number; height: number }>) {
  const namespace = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(namespace, 'g');
  group.setAttribute('fill', '#8E8E93');
  group.setAttribute('opacity', '0.26');
  for (const rect of rects) {
    const highlight = document.createElementNS(namespace, 'rect');
    highlight.setAttribute('x', String(rect.left - 2));
    highlight.setAttribute('y', String(rect.top - 1));
    highlight.setAttribute('width', String(rect.width + 4));
    highlight.setAttribute('height', String(rect.height + 2));
    highlight.setAttribute('rx', '4');
    highlight.setAttribute('ry', '4');
    group.append(highlight);
  }
  return group;
}

export function drawRevealRects(rects: Array<{ left: number; top: number; width: number; height: number }>) {
  const namespace = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(namespace, 'g');
  group.setAttribute('fill', REVEAL_FILL);
  group.setAttribute('opacity', REVEAL_OPACITY);
  for (const rect of rects) {
    const reveal = document.createElementNS(namespace, 'rect');
    reveal.setAttribute('x', String(rect.left - 1));
    reveal.setAttribute('y', String(rect.top));
    reveal.setAttribute('width', String(rect.width + 2));
    reveal.setAttribute('height', String(rect.height));
    reveal.setAttribute('rx', '3');
    reveal.setAttribute('ry', '3');
    group.append(reveal);
  }
  return group;
}

export function drawHighlightRects(rects: Array<{ left: number; top: number; width: number; height: number }>) {
  const namespace = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(namespace, 'g');
  group.setAttribute('fill', HIGHLIGHT_FILL);
  group.setAttribute('opacity', HIGHLIGHT_OPACITY);
  for (const rect of rects) {
    const highlight = document.createElementNS(namespace, 'rect');
    highlight.setAttribute('x', String(rect.left - 1));
    highlight.setAttribute('y', String(rect.top));
    highlight.setAttribute('width', String(rect.width + 2));
    highlight.setAttribute('height', String(rect.height));
    highlight.setAttribute('rx', '3');
    highlight.setAttribute('ry', '3');
    group.append(highlight);
  }
  return group;
}
