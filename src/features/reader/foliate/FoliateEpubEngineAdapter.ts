import type {
  FootnoteAnchorRect,
  FootnotePayload,
  FootnoteRichTextNode,
  FootnoteSemanticType,
  ReaderBookmarkAnchor,
  ReaderBookmarkSnapshot,
  ReaderEngineDiagnostic,
  ReaderLocation,
  ReaderResourcePayload,
  ReaderRestoreState,
  ReaderSearchResult,
  ReaderExcerptVerificationItem,
  ReaderSelectionPayload,
  ReaderSelectionRect,
  ReaderPageLocationResult,
  ReaderPageLocationTarget,
  ReaderTocItem,
  ReaderZipEntry,
} from '../reader-types';
import type { ReaderPageCountCache } from '../reader-page-cache-repository';
import { getGlobalReaderPage } from '../reader-pagination';
import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
  readerLayoutSettingsEqual,
  readerSettingsEqual,
  type ReaderSettings,
} from '../reader-settings';

type FoliateRawLocation = {
  cfi?: string;
  fraction?: number;
  section?: { current?: number };
  tocItem?: { id?: number; label?: string } | null;
  range?: Range;
};

type FoliateSection = {
  id?: string;
  cfi?: string;
  linear?: string;
  createDocument?: () => Promise<Document>;
  resolveHref?: (href: string) => string;
};

type FoliateResolvedHref = {
  index?: number;
  anchor?: (doc: Document) => Range | Element | number | null;
} | null | undefined;

type FoliateViewBook = {
  sections?: FoliateSection[];
  toc?: unknown[];
  resolveHref?: (href: string) => FoliateResolvedHref;
  loadText?: (name: string) => Promise<string | null>;
  parser?: DOMParser;
};

type FoliateRenderer = HTMLElement & {
  atStart?: boolean;
  atEnd?: boolean;
  page?: number;
  pages?: number;
};

type FoliateBook = {
  transformTarget?: EventTarget;
};

type FoliateView = HTMLElement & {
  book?: FoliateViewBook;
  language?: { canonical?: string };
  isFixedLayout?: boolean;
  renderer?: FoliateRenderer;
  lastLocation?: FoliateRawLocation | null;
  open: (book: File | Blob | FoliateBook) => Promise<void>;
  init: (options: { lastLocation: string | null; showTextStart: boolean }) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  goTo: (target: string | number) => Promise<void>;
  getCFI?: (index: number, range: Range) => string;
  getProgressOf?: (index: number, range: Range) => { tocItem?: { label?: string } | null };
  resolveNavigation?: (target: string | number) => FoliateResolvedHref;
  addAnnotation?: (annotation: { kind: string; value: string }) => Promise<unknown>;
  deleteAnnotation?: (annotation: { kind: string; value: string }) => Promise<unknown>;
  clearSearch?: () => void;
  close: () => void;
};

type ReaderInteractionState = 'idle' | 'pointerDown' | 'turning' | 'selecting';

type ReaderPointerSession = {
  pointerId: number;
  startX: number;
  startY: number;
  startScreenX: number;
  startScreenY: number;
  startedAt: number;
  target: EventTarget | null;
  selectionWasActive: boolean;
  // A second intentional gesture can arrive while the current visual
  // transition is still finishing. Keep its raw data so the last page-turn
  // intent can be queued instead of silently disappearing.
  startedWhileTurning: boolean;
};

type PageViewTransition = {
  finished: Promise<unknown>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => PageViewTransition;
};

const TAP_EDGE_RATIO = 0.25;
const TAP_MAX_DURATION_MS = 280;
const TAP_MAX_MOVEMENT_PX = 10;
const SWIPE_MIN_DISTANCE_PX = 42;
const SWIPE_DIRECTION_DOMINANCE = 1.25;
const SELECTION_SETTLE_MS = 80;
const PAGE_COUNT_BATCH_SIZE = 12;
export const READER_VERTICAL_MARGIN_PX = 80;
export const READER_CONTENT_OFFSET_Y_PX = 32;
export const READER_CONTENT_HEIGHT_REDUCTION_PX = 32;
export const READER_PAGE_DISSOLVE_MS = 240;
export const READER_PAGE_DISSOLVE_DELAY_MS = 0;
const READER_CONTENT_TOP_PX = READER_VERTICAL_MARGIN_PX + READER_CONTENT_OFFSET_Y_PX;
const READER_CONTENT_BOTTOM_PX = READER_VERTICAL_MARGIN_PX;
const READER_VERTICAL_MARGIN = `${READER_VERTICAL_MARGIN_PX}px`;
const READER_STANDALONE_MEDIA_HEIGHT = `calc(100vh - ${READER_CONTENT_TOP_PX + READER_CONTENT_BOTTOM_PX}px)`;

type PendingPageTurn = {
  direction: 'next' | 'prev';
};

// ── Footnote popover (Footnote Core A) ─────────────────────────────
// Semantic-first footnote support: only anchors/targets carrying explicit
// EPUB footnote semantics are intercepted. Non-semantic links keep their
// default behavior; DEV logs record candidates for future heuristics.

type FootnoteReference = {
  rawHref: string;
  fragment: string;
  targetPath: string;
  crossDocument: boolean;
  sectionIndex: number;
  isExplicitNoteref: boolean;
  semanticType: FootnoteSemanticType;
  /** Same-document target, resolved synchronously during classification. */
  targetElement: Element | null;
};

const FOOTNOTE_BACKLINK_ARROWS = new Set(['↩', '↪', '↑', '↓', '⏎', '←', '→', '^', '«', '»']);
const FOOTNOTE_LEADING_NUMBER_RE = /^[0-9\s.\[\]()\-–—]+$/;
const FOOTNOTE_LEADING_NUMBER_PREFIX_RE = /^[0-9\s.\[\]()\-–—]+?(?=\s)/;
const FOOTNOTE_EXTERNAL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const FOOTNOTE_SUPERSCRIPT_DIGITS: Record<string, string> = {
  '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5',
  '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁰': '0',
};

/** Normalize a noteref/footnote label to its digit key ("[1]" → "1", "¹" → "1"). */
function footnoteDigitKey(label: string): string {
  const normalized = label.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, (c) => FOOTNOTE_SUPERSCRIPT_DIGITS[c] ?? c);
  return (normalized.match(/[0-9]+/g) ?? []).join('');
}

function hasSubstantiveContentAfter(node: Node): boolean {
  let sibling: Node | null = node.nextSibling;
  while (sibling) {
    if ((sibling.textContent ?? '').trim() !== '') return true;
    sibling = sibling.nextSibling;
  }
  const parent = node.parentNode;
  if (parent && parent.nodeType === Node.ELEMENT_NODE) {
    let ps: Node | null = parent.nextSibling;
    while (ps) {
      if ((ps.textContent ?? '').trim() !== '') return true;
      ps = ps.nextSibling;
    }
  }
  return false;
}

function decodeFootnoteFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function findFragmentElement(doc: Document, fragment: string): Element | null {
  return doc.getElementById(fragment)
    ?? doc.querySelector(`[id="${CSS.escape(fragment)}"]`);
}

function getFootnoteSemanticType(element: Element): FootnoteSemanticType | null {
  const epubType = element.getAttribute('epub:type');
  const role = element.getAttribute('role');
  if (epubType === 'footnote' || role === 'doc-footnote') return 'footnote-target';
  if (epubType === 'endnote' || role === 'doc-endnote') return 'endnote-target';
  return null;
}

function isFootnoteTargetElement(element: Element): boolean {
  return getFootnoteSemanticType(element) !== null;
}

// ── Heuristic footnote detection (v2) ─────────────────────────────────
// Semantic-first stays the primary path. These heuristics only run for
// same-document fragment links that carry NO explicit footnote semantics,
// so real-world books with plain `<a href="#fn1">1</a>` markers also pop
// over instead of jumping to the chapter end. Conservative by design:
// every base condition must hold, plus at least one footnote signal.

/** Marker-like labels: digits, [1], (1), 〔1〕, superscript ¹²³, *, †, ‡. */
const FOOTNOTE_HEURISTIC_MARKER_RE = /^[0-9¹²³⁴⁵⁶⁷⁸⁹⁰\s.[\]()\-–—*†‡〔〕【】〈〉《》]+$/;
/** Section headings that suggest a notes area: 注/释/footnote/endnote. */
const FOOTNOTE_NOTES_HEADING_RE = /注|释|footnote|endnote/i;
/** id/class hints: footnote, endnote, fn1, note-2 … */
const FOOTNOTE_ID_CLASS_HINT_RE = /footnote|endnote|^(fn|note)[-_ ]?\d*$/i;
/** Minimum substantive text for a heuristic target (avoids empty anchors). */
const FOOTNOTE_HEURISTIC_MIN_TEXT = 4;
/** Tags that disqualify a heuristic target (TOC-style jumps). */
const FOOTNOTE_HEURISTIC_BAD_TARGET_RE = /^(h1|h2|h3|h4|h5|h6|a|script|style)$/i;

/** True when the anchor itself is a "back to text" link — never intercepted. */
function isBacklinkAnchor(anchor: HTMLAnchorElement): boolean {
  const epubType = anchor.getAttribute('epub:type');
  const role = anchor.getAttribute('role');
  if (epubType === 'backlink' || role === 'doc-backlink') return true;
  return FOOTNOTE_BACKLINK_ARROWS.has((anchor.textContent ?? '').trim());
}

/**
 * Real-world footnote targets are often marker anchors (`<a id="fn1">`, or
 * the backlink itself carrying the id) rather than the footnote body.
 * Promote text-less anchor targets to the enclosing block so extraction and
 * heuristics operate on the actual note content.
 */
function resolveFootnoteBody(target: Element): Element {
  if (target.tagName.toLowerCase() !== 'a') return target;
  const label = (target.textContent ?? '').trim();
  // An anchor carrying real text is the content itself; a marker-like (or
  // empty) anchor is just a marker — delegate to the enclosing block.
  const isMarker = label === ''
    || label.length < FOOTNOTE_HEURISTIC_MIN_TEXT
    || FOOTNOTE_HEURISTIC_MARKER_RE.test(label);
  if (!isMarker) return target;
  const parent = target.closest('p,li,aside,div,section,blockquote,dd');
  return parent && parent !== target ? parent : target;
}

/**
 * True when the target contains a back-to-text link. Besides explicit
 * backlink semantics and arrow labels, recognizes mutual linkage: a link
 * whose fragment equals the citing anchor's own id (e.g. `<a class="hl"
 * href="#id0">` inside the note citing `<a id="id0">`). Sloppy real-world
 * books use this instead of any backlink markup.
 */
function footnoteTargetHasBacklink(target: Element, anchorId: string | null): boolean {
  const links = target.querySelectorAll('a[href]');
  for (const link of Array.from(links)) {
    const href = link.getAttribute('href') ?? '';
    if (FOOTNOTE_EXTERNAL_SCHEME_RE.test(href)) continue;
    const hashIndex = href.indexOf('#');
    if (hashIndex < 0) continue;
    if (isBacklinkAnchor(link as HTMLAnchorElement)) return true;
    if (anchorId && decodeFootnoteFragment(href.slice(hashIndex + 1)) === anchorId) return true;
  }
  return false;
}

/**
 * True when the element sits inside a footnote area: explicit footnote
 * semantics on self/ancestors, or a "notes" label block (e.g.
 * `<p><span>注 释</span></p>`, `<h2>Footnotes</h2>`) among preceding
 * siblings. Real-world books often use flat structures with no section
 * wrapper, so the sibling scan covers that. Used to keep backlink taps
 * (inside the notes) on default navigation.
 */
function isInFootnoteArea(element: Element): boolean {
  let el: Element | null = element;
  while (el && el.tagName.toLowerCase() !== 'body') {
    if (getFootnoteSemanticType(el)) return true;
    el = el.parentElement;
  }
  const block = element.closest('p,li,aside,div,section,blockquote,dd');
  let sibling: Element | null = block?.previousElementSibling ?? null;
  while (sibling) {
    const tag = sibling.tagName.toLowerCase();
    const text = (sibling.textContent ?? '').replace(/[\s\u3000]+/g, '');
    if (text.length > 0 && text.length <= 16 && FOOTNOTE_NOTES_HEADING_RE.test(text)) return true;
    if (/^h[1-6]$/.test(tag)) return false;
    sibling = sibling.previousElementSibling;
  }
  return false;
}

/**
 * True when the target sits inside a notes-like section: an ancestor
 * section/aside/div/ol/ul whose heading or id/class mentions
 * 注/释/footnote/endnote, or whose own id/class carries a note hint.
 */
function footnoteTargetInNotesSection(target: Element): boolean {
  let el: Element | null = target.parentElement;
  while (el && el.tagName.toLowerCase() !== 'body') {
    const tag = el.tagName.toLowerCase();
    if (tag === 'section' || tag === 'aside' || tag === 'div' || tag === 'ol' || tag === 'ul') {
      const idClass = `${el.getAttribute('id') ?? ''} ${(el as HTMLElement).className ?? ''}`;
      if (FOOTNOTE_ID_CLASS_HINT_RE.test(idClass)) return true;
      const headings = el.querySelectorAll('h1,h2,h3,h4,h5,h6');
      for (const h of Array.from(headings)) {
        // Only headings that belong directly to this section level.
        if ((h as Element).parentElement !== el) continue;
        if (FOOTNOTE_NOTES_HEADING_RE.test((h.textContent ?? ''))) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

function footnoteTargetIdClassHint(target: Element): boolean {
  const idClass = `${target.getAttribute('id') ?? ''} ${(target as HTMLElement).className ?? ''}`;
  return FOOTNOTE_ID_CLASS_HINT_RE.test(idClass);
}

/**
 * Heuristic: does this non-semantic same-document link look like a footnote
 * reference whose target looks like a footnote body? All base conditions
 * must hold, plus at least one footnote signal.
 */
function isHeuristicFootnoteReference(
  anchor: HTMLAnchorElement,
  target: Element,
): boolean {
  if (isBacklinkAnchor(anchor)) return false;
  // A tap inside the notes area is a backlink (or nested content), never a
  // new reference — leave it on default navigation.
  if (isInFootnoteArea(anchor)) return false;
  const label = (anchor.textContent ?? '').trim();
  if (label === '' || label.length > 8 || !FOOTNOTE_HEURISTIC_MARKER_RE.test(label)) return false;
  if (FOOTNOTE_HEURISTIC_BAD_TARGET_RE.test(target.tagName)) return false;
  const text = (target.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < FOOTNOTE_HEURISTIC_MIN_TEXT) return false;
  return (
    footnoteTargetHasBacklink(target, anchor.getAttribute('id'))
    || footnoteTargetInNotesSection(target)
    || footnoteTargetIdClassHint(target)
  );
}

/**
 * Strip backlinks ("↩", epub:type="backlink", role="doc-backlink"): closing
 * the popover already returns the reader to the original position, so a
 * back-to-text link inside the popover is meaningless.
 * `citingAnchorId` catches mutual backlinks with no backlink markup: any
 * same-document link pointing back at the citing anchor's own id.
 */
function cleanFootnoteClone(clone: Element, citingAnchorId?: string | null): void {
  for (const backlink of Array.from(clone.querySelectorAll('[epub\\:type="backlink"], [role="doc-backlink"]'))) {
    backlink.remove();
  }
  for (const anchor of Array.from(clone.querySelectorAll('a'))) {
    const href = anchor.getAttribute('href') ?? '';
    const label = (anchor.textContent ?? '').trim();
    if (anchor.getAttribute('epub:type') === 'backlink' || anchor.getAttribute('role') === 'doc-backlink') {
      anchor.remove();
    } else if (href.startsWith('#') && FOOTNOTE_BACKLINK_ARROWS.has(label)) {
      anchor.remove();
    } else if (citingAnchorId) {
      const hashIndex = href.indexOf('#');
      if (hashIndex >= 0 && decodeFootnoteFragment(href.slice(hashIndex + 1)) === citingAnchorId) {
        anchor.remove();
      }
    }
  }
  for (const backlink of Array.from(clone.querySelectorAll('[epub\\:type="backlink"], [role="doc-backlink"]'))) {
    backlink.remove();
  }
  for (const anchor of Array.from(clone.querySelectorAll('a'))) {
    const href = anchor.getAttribute('href') ?? '';
    const label = (anchor.textContent ?? '').trim();
    if (anchor.getAttribute('epub:type') === 'backlink' || anchor.getAttribute('role') === 'doc-backlink') {
      anchor.remove();
    } else if (href.startsWith('#') && FOOTNOTE_BACKLINK_ARROWS.has(label)) {
      anchor.remove();
    } else if (citingAnchorId) {
      const hashIndex = href.indexOf('#');
      if (hashIndex >= 0 && decodeFootnoteFragment(href.slice(hashIndex + 1)) === citingAnchorId) {
        anchor.remove();
      }
    }
  }
  for (const inert of Array.from(clone.querySelectorAll('script, style, template, iframe, object, embed, audio, video, form, input, button, select, textarea'))) {
    inert.remove();
  }
}

/**
 * Remove a leading footnote-number marker ("1", "1.", "[2]") that duplicates
 * the tapped noteref's label. Only strips when the leading digits match the
 * anchor's own label digits, so body numbers ("1984年", "12,345") are never
 * touched. Handles both `<span>1.</span> text` and `1. text` shapes.
 */
function stripLeadingFootnoteNumber(clone: Element, anchorLabel: string): void {
  const anchorDigits = footnoteDigitKey(anchorLabel);
  if (!anchorDigits) return;
  const parents: Element[] = [clone];
  const firstBlock = clone.firstElementChild;
  if (firstBlock) parents.push(firstBlock);
  for (const parent of parents) {
    const first = parent.firstChild;
    if (!first) continue;
    if (first.nodeType === Node.ELEMENT_NODE) {
      const label = (first.textContent ?? '').trim();
      if (label === '' || !FOOTNOTE_LEADING_NUMBER_RE.test(label)) continue;
      if (footnoteDigitKey(label) !== anchorDigits) continue;
      if (!hasSubstantiveContentAfter(first)) continue;
      first.remove();
      return;
    }
    if (first.nodeType === Node.TEXT_NODE) {
      const text = first.textContent ?? '';
      const match = FOOTNOTE_LEADING_NUMBER_PREFIX_RE.exec(text);
      if (!match) continue;
      if (footnoteDigitKey(match[0]) !== anchorDigits) continue;
      const rest = text.slice(match[0].length);
      if (rest.trim() === '' && !hasSubstantiveContentAfter(first)) continue;
      first.textContent = rest.replace(/^\s+/, '');
      return;
    }
  }
}

function footnoteNodeToRichText(node: Node): FootnoteRichTextNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ');
    return text === '' ? [] : [{ kind: 'text', text }];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'iframe'
    || tag === 'object' || tag === 'embed' || tag === 'audio' || tag === 'video'
    || tag === 'form' || tag === 'input' || tag === 'button' || tag === 'select' || tag === 'textarea') {
    return [];
  }
  const children = Array.from(element.childNodes).flatMap(footnoteNodeToRichText);
  switch (tag) {
    case 'br':
      return [{ kind: 'break' }];
    case 'em':
    case 'i':
      return [{ kind: 'em', children }];
    case 'strong':
    case 'b':
      return [{ kind: 'strong', children }];
    case 'p':
    case 'div':
    case 'section':
    case 'aside':
    case 'li':
    case 'blockquote':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return [{ kind: 'paragraph', children }];
    case 'a': {
      const href = element.getAttribute('href') ?? '';
      // External links stay tappable. Every internal link (nested noteref,
      // backlink remnant, section link) unwraps to plain text: the popover
      // is transient and must never navigate the reader away.
      if (FOOTNOTE_EXTERNAL_SCHEME_RE.test(href)) return [{ kind: 'link', href, children }];
      return children;
    }
    default:
      // span, sub, sup, small, etc.: keep the text, drop the tag.
      return children;
  }
}

function footnoteRichTextToPlainText(nodes: FootnoteRichTextNode[]): string {
  const raw = nodes.map((node) => {
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'break':
        return '\n';
      case 'paragraph':
        return `${footnoteRichTextToPlainText(node.children)}\n`;
      default:
        return footnoteRichTextToPlainText(node.children);
    }
  }).join('');
  return raw.replace(/ +\n/g, '\n').replace(/\n +/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeFootnoteHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Regenerated from the rich-text whitelist, so it is sanitized by construction. */
function footnoteRichTextToHtml(nodes: FootnoteRichTextNode[]): string {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'text':
        return escapeFootnoteHtml(node.text);
      case 'em':
        return `<em>${footnoteRichTextToHtml(node.children)}</em>`;
      case 'strong':
        return `<strong>${footnoteRichTextToHtml(node.children)}</strong>`;
      case 'break':
        return '<br/>';
      case 'paragraph':
        return `<p>${footnoteRichTextToHtml(node.children)}</p>`;
      case 'link':
        return `<a href="${escapeFootnoteHtml(node.href)}">${footnoteRichTextToHtml(node.children)}</a>`;
    }
  }).join('');
}

function extractFootnoteContent(
  target: Element,
  anchorLabel: string,
  citingAnchorId?: string | null,
): { text: string; richText: FootnoteRichTextNode[]; html: string } {
  const clone = target.cloneNode(true) as Element;
  cleanFootnoteClone(clone, citingAnchorId);
  stripLeadingFootnoteNumber(clone, anchorLabel);
  const richText = Array.from(clone.childNodes).flatMap(footnoteNodeToRichText);
  const text = footnoteRichTextToPlainText(richText);
  const html = footnoteRichTextToHtml(richText);
  return { text, richText, html };
}

export type FoliateOpenInput = {
  bookId: string;
  base64?: string;
  entries?: ReaderZipEntry[];
  fileName: string;
  onResourceRequest: (name: string) => Promise<ReaderResourcePayload | null>;
  /** Metadata texts prefetched natively; checked before any bridge request. */
  prefetchedText?: Record<string, string>;
  restoreCfi: string | null;
  sourceKind: 'zip-resource-loader' | 'full-base64-fallback';
  pageCountCache: ReaderPageCountCache | null;
  readerSettings: ReaderSettings;
};

type ReaderPageCountResult = Omit<ReaderPageCountCache, 'bookId' | 'updatedAt'>;

function base64ToBytes(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function cssText(value: unknown): Promise<string> {
  const resolved = await value;
  if (typeof resolved === 'string') return resolved;
  if (resolved instanceof Blob) return resolved.text();
  if (resolved instanceof ArrayBuffer) return new TextDecoder().decode(resolved);
  if (ArrayBuffer.isView(resolved)) {
    return new TextDecoder().decode(new Uint8Array(resolved.buffer, resolved.byteOffset, resolved.byteLength));
  }
  return resolved == null ? '' : String(resolved);
}

function normalizeBookStyles(book: FoliateBook) {
  // A few real-world EPUBs expose stylesheet bytes/Blobs through their
  // manifest. foliate's paginator expects CSS to be a string and otherwise
  // calls `.replace()` on that value. Register before `view.open()` so this
  // narrow compatibility normalizer runs before the paginator listener.
  book.transformTarget?.addEventListener('data', (event) => {
    const dataEvent = event as CustomEvent<{ type?: unknown; data?: unknown }>;
    if (dataEvent.detail.type === 'text/css') dataEvent.detail.data = cssText(dataEvent.detail.data);
  });
}

async function createOnDemandBook(
  input: FoliateOpenInput,
  epubModulePromise: Promise<typeof import('foliate-js/epub.js')> = import('foliate-js/epub.js'),
): Promise<FoliateBook> {
  const entries = new Map((input.entries ?? []).map((entry) => [entry.name, entry]));
  const decoder = new TextDecoder();
  const prefetchedText = input.prefetchedText ?? {};
  const loadBytes = async (name: string) => {
    const resource = await input.onResourceRequest(name);
    if (!resource) return null;
    return base64ToBytes(resource.base64);
  };
  const { EPUB } = await epubModulePromise;
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

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function mapToc(items: unknown, resolveHref?: (href: string) => FoliateResolvedHref): ReaderTocItem[] {
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

function drawSearchResultHighlight(rects: Array<{ left: number; top: number; width: number; height: number }>) {
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

/** The only formal Reader Core wrapper around foliate-js. */
export class FoliateEpubEngineAdapter {
  private view: FoliateView | null = null;
  // Every loaded spine document gets exactly one owner and one stable index.
  // A Map also lets destroy remove listeners from every still-live document.
  private loadedDocuments = new Map<Document, number>();
  private gestureCleanups = new Map<Document, () => void>();
  private selectionCleanups = new Map<Document, () => void>();
  private footnoteCleanups = new Map<Document, () => void>();
  // A tap that begins with an active text selection is owned by selection
  // dismissal. The click handler consumes this flag so a footnote popover
  // never fires on the same tap (selection > footnote > page tap).
  private footnoteTapSelectionGuard = false;
  private activeSelection: { doc: Document; payload: ReaderSelectionPayload } | null = null;
  private bookId: string | null = null;
  private restoreState: ReaderRestoreState = 'opening';
  private interactionState: ReaderInteractionState = 'idle';
  private pointerSession: ReaderPointerSession | null = null;
  private pageTransitionActive = false;
  private pendingPageTurn: PendingPageTurn | null = null;
  private rendererTouchCleanup: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: number | null = null;
  private reflowing = false;
  private pageCountCache: ReaderPageCountCache | null = null;
  private layoutSignature: string | null = null;
  private pageCountRun = 0;
  private pageCountTimer: number | null = null;
  private pageCountInput: FoliateOpenInput | null = null;
  private pageLocatorRun = 0;
  private pageLocatorQueue = Promise.resolve();
  private readerSettings: ReaderSettings = DEFAULT_READER_SETTINGS;
  private settingsApplyQueue = Promise.resolve();
  private settingsSessionActive = false;
  private settingsSessionAnchorCfi: string | null = null;
  private searchRun = 0;
  private searchActive = false;
  private searchQueue = Promise.resolve();
  private selectedSearchHighlightCfi: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly onLocation: (location: ReaderLocation, restoreState: ReaderRestoreState) => void,
    private readonly onCenterTap: () => void,
    private readonly onDiagnostic: (diagnostic: ReaderEngineDiagnostic) => void,
    private readonly onPageCount: (result: ReaderPageCountResult) => void,
    private readonly onToc: (toc: ReaderTocItem[]) => void,
    private readonly onSelectionChange: (selection: ReaderSelectionPayload | null) => void,
    private readonly onFootnoteOpen: (payload: FootnotePayload) => void,
  ) {}

  async open(input: FoliateOpenInput): Promise<ReaderLocation> {
    this.destroy();
    this.bookId = input.bookId;
    this.readerSettings = normalizeReaderSettings(input.readerSettings);
    this.applyReaderAppearanceToHost();
    this.pageCountInput = { ...input, readerSettings: this.readerSettings };
    this.restoreState = 'opening';
    // These two modules have no initialization dependency on one another.
    // Fetching them together removes one whole DOM-module round trip on the
    // route-local host while preserving foliate's normal open/init lifecycle.
    const viewModulePromise = import('foliate-js/view.js');
    const epubModulePromise = input.sourceKind === 'zip-resource-loader'
      ? import('foliate-js/epub.js')
      : null;
    this.onDiagnostic({ event: 'BOOK_BUILD_START' });
    const bookPromise = input.sourceKind === 'zip-resource-loader'
      ? createOnDemandBook(input, epubModulePromise!)
      : null;
    const { makeBook } = await viewModulePromise;
    this.onDiagnostic({ event: 'FOLIATE_IMPORT_END' });

    const view = document.createElement('foliate-view') as FoliateView;
    view.style.display = 'block';
    view.style.width = '100%';
    view.style.height = '100%';
    view.style.backgroundColor = this.getReaderColors().background;
    view.style.visibility = 'hidden';
    // The browser snapshots only this DOM reader surface. Native title, Chrome,
    // and the fixed Reader background remain outside the cross-dissolve.
    view.style.setProperty('view-transition-name', 'reader-page');
    view.setAttribute('flow', 'paginated');
    view.addEventListener('relocate', this.handleRelocate);
    view.addEventListener('load', this.handleDocumentLoad as EventListener);
    view.addEventListener('draw-annotation', this.handleDrawAnnotation as EventListener);
    this.host.replaceChildren(view);
    this.view = view;

    const book = input.sourceKind === 'zip-resource-loader'
      ? await bookPromise!
      : await makeBook(new File([base64ToBytes(input.base64 ?? '')], input.fileName, { type: 'application/epub+zip' })) as FoliateBook;
    this.onDiagnostic({ event: 'BOOK_BUILD_END' });
    normalizeBookStyles(book);
    this.onDiagnostic({ event: 'BOOK_OPEN_START' });
    await view.open(book);
    view.classList.toggle('reader-reflowable', !view.isFixedLayout);
    // foliate parses EPUB3 nav or falls back to EPUB2 NCX during view.open().
    // Publish the result before init emits the first active relocation; that
    // relocation promotes Native state from opening to ready and intentionally
    // tears down the opening effect that owns the source prop.
    const toc = this.getToc();
    this.onToc(toc);
    this.onDiagnostic({ event: 'BOOK_OPEN_END' });
    this.onDiagnostic({ event: 'ENGINE_OPENED' });
    // `foliate-view` owns an internal `foliate-paginator`; its margin is not
    // inherited from the outer custom element. Give the reader a deliberate
    // top/bottom breathing area without adding a visible container or card.
    this.onDiagnostic({ event: 'STYLE_APPLY_START' });
    view.renderer?.setAttribute('margin', READER_VERTICAL_MARGIN);
    view.renderer?.setAttribute('gap', `${this.readerSettings.pageMargin}%`);
    // foliate also owns a paginator-level touch listener outside each EPUB
    // section document. Block that alternate path too: it otherwise leaks
    // through during very fast swipes and produces foliate's own snap/scroll
    // instead of the single View Transition pipeline below.
    this.attachRendererTouchBlocker(view.renderer);
    this.onDiagnostic({ event: 'STYLE_APPLY_END' });
    this.layoutSignature = this.createLayoutSignature();
    this.pageCountCache = this.isCacheUsable(input.pageCountCache, this.layoutSignature)
      ? input.pageCountCache
      : null;
    // This is the same one-pass restore path proven by the Spike: foliate
    // resolves the CFI while it builds the paginator, rather than first
    // laying out the book start and then performing a second `goTo()` layout.
    this.restoreState = 'restoring';
    const targetCfi = input.restoreCfi?.startsWith('epubcfi(') ? input.restoreCfi : null;
    this.onDiagnostic({ event: 'RESTORE_REQUEST', targetCfi });
    this.onDiagnostic({ event: 'VIEW_INIT_START' });
    this.onDiagnostic({ event: 'PAGINATION_START' });
    await view.init({ lastLocation: targetCfi, showTextStart: true });
    this.onDiagnostic({ event: 'PAGINATION_END' });
    this.onDiagnostic({ event: 'VIEW_INIT_END' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const location = this.getLocation();
    this.onDiagnostic({ event: 'RESTORE_RESULT', targetCfi, actualCurrentCfi: location.cfi });
    this.restoreState = 'active';
    view.style.visibility = 'visible';
    view.style.opacity = '1';
    this.installViewportObserver();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    this.onDiagnostic({ event: 'FIRST_PAGE_RENDERED' });
    this.onLocation(location, this.restoreState);
    this.scheduleBackgroundPageCount(input);
    return location;
  }

  async next() {
    await this.requestPageTurn('next');
  }

  async prev() {
    await this.requestPageTurn('prev');
  }

  applySettings(settings: ReaderSettings) {
    const normalized = normalizeReaderSettings(settings);
    const sessionAnchorCfi = this.settingsSessionAnchorCfi;
    this.settingsApplyQueue = this.settingsApplyQueue
      .catch(() => undefined)
      .then(() => this.applySettingsInternal(normalized, sessionAnchorCfi));
    return this.settingsApplyQueue;
  }

  setSettingsSessionActive(active: boolean) {
    if (active === this.settingsSessionActive) return;
    this.settingsSessionActive = active;
    if (active) {
      this.pageCountRun += 1;
      this.cancelPageLocation();
      if (this.pageCountTimer !== null) window.clearTimeout(this.pageCountTimer);
      this.pageCountTimer = null;
      try {
        this.settingsSessionAnchorCfi = this.restoreState === 'active' ? this.getLocation().cfi : null;
      } catch {
        this.settingsSessionAnchorCfi = null;
      }
      return;
    }
    this.settingsSessionAnchorCfi = null;
    this.scheduleBackgroundPageCount();
  }

  getLocation(): ReaderLocation {
    const raw = this.view?.lastLocation;
    const cfi = raw?.cfi;
    if (!cfi) throw new Error('foliate-js 未返回 EPUB CFI。');
    const sections = this.view?.book?.sections ?? [];
    const resolvedIndex = raw?.section?.current;
    const cfiIndex = sections.findIndex((section) => section.cfi && cfi.includes(section.cfi));
    const renderer = this.view?.renderer;
    // foliate's paginated renderer reserves one leading and one trailing
    // column for relocation. The readable columns are numbered 1 through
    // `pages - 2`, and `renderer.page` already uses that numbering. Adding
    // one here made the UI advance by an extra page within every section.
    const sectionPage = typeof renderer?.page === 'number' ? renderer.page : null;
    const spineIndex = typeof resolvedIndex === 'number' ? resolvedIndex : cfiIndex >= 0 ? cfiIndex : 0;
    const currentPage = sectionPage === null
      ? null
      : this.pageCountCache
        ? getGlobalReaderPage(this.pageCountCache.sectionPages, spineIndex, sectionPage)
        : sectionPage;
    return {
      cfi,
      spineIndex,
      tocItemId: typeof raw?.tocItem?.id === 'number' ? raw.tocItem.id : null,
      percentage: clampPercentage((raw?.fraction ?? 0) * 100),
      // foliate provides the immediately visible page within the current
      // paginated section. This is display-only; CFI remains the sole anchor.
      currentPage,
      // A global total must be counted/cached after first paint. Never invent
      // one from percentage or the current section's page count.
      totalPages: this.pageCountCache?.totalPages ?? null,
    };
  }

  async goTo(location: string) {
    const view = this.view;
    if (!view) throw new Error('Reader 尚未就绪。');
    const resolved = view.resolveNavigation?.(location) ?? view.book?.resolveHref?.(location);
    if (!resolved || typeof resolved.index !== 'number' || resolved.index < 0) {
      throw new Error(`Reader 目标无效：${location}`);
    }
    this.clearActiveSelection(true);
    await this.clearSelectedSearchHighlight();
    this.reflowing = true;
    try {
      await view.goTo(location);
      await this.nextFrame();
      const current = this.getLocation();
      if (current.spineIndex !== resolved.index) throw new Error(`Reader 目标未能定位：${location}`);
      return current;
    } finally {
      this.reflowing = false;
    }
  }

  async goToSearchResult(cfi: string) {
    const location = await this.goTo(cfi);
    const view = this.view;
    if (!view?.addAnnotation) return location;
    this.selectedSearchHighlightCfi = cfi;
    await view.addAnnotation({ kind: 'reader-search-result', value: cfi });
    return location;
  }

  getProgress() {
    return this.getLocation().percentage;
  }

  getToc() {
    const book = this.view?.book;
    return mapToc(book?.toc, book?.resolveHref?.bind(book));
  }

  async getBookmarkSnapshot(bookmarks: ReaderBookmarkAnchor[]): Promise<ReaderBookmarkSnapshot> {
    const view = this.view;
    const raw = view?.lastLocation;
    const visibleRange = raw?.range;
    if (!view?.getCFI || !visibleRange) throw new Error('Reader 当前可见位置尚未稳定。');

    const spineIndex = typeof raw.section?.current === 'number'
      ? raw.section.current
      : this.getLocation().spineIndex;
    const anchor = visibleRange.cloneRange();
    anchor.collapse(true);
    const cfi = view.getCFI(spineIndex, anchor);
    const root = visibleRange.startContainer.getRootNode();
    const doc = root instanceof Document ? root : visibleRange.startContainer.ownerDocument;
    const body = doc?.body ?? doc?.documentElement ?? null;
    let sectionFraction = 0;
    if (doc && body) {
      try {
        const before = doc.createRange();
        before.selectNodeContents(body);
        before.setEnd(anchor.startContainer, anchor.startOffset);
        const totalLength = body.textContent?.length ?? 0;
        sectionFraction = totalLength > 0
          ? Math.max(0, Math.min(1, before.toString().length / totalLength))
          : 0;
      } catch {
        sectionFraction = 0;
      }
    }

    const excerpt = visibleRange.toString().replace(/\s+/g, ' ').trim().slice(0, 100);
    let matchedBookmarkId: number | null = null;
    if (doc) {
      for (const bookmark of bookmarks) {
        if (bookmark.spineIndex !== spineIndex) continue;
        if (bookmark.cfi === cfi) {
          matchedBookmarkId = bookmark.id;
          break;
        }
        try {
          const resolved = view.resolveNavigation?.(bookmark.cfi);
          if (!resolved || resolved.index !== spineIndex || !resolved.anchor) continue;
          const candidate = resolved.anchor(doc);
          if (!candidate || typeof candidate === 'number') continue;
          const pointContainer = 'startContainer' in candidate ? candidate.startContainer : candidate;
          const pointOffset = 'startOffset' in candidate ? candidate.startOffset : 0;
          const pointRange = doc.createRange();
          pointRange.setStart(pointContainer, pointOffset);
          pointRange.collapse(true);
          const visibleEnd = visibleRange.cloneRange();
          visibleEnd.collapse(false);
          // Adjacent pages share one boundary: the previous page's end is the
          // next page's start. Treat the visible page as [start, end), so that
          // shared CFI belongs only to the following page.
          const isBeforeVisibleEnd = pointRange.compareBoundaryPoints(0, visibleEnd) < 0;
          if (visibleRange.comparePoint(pointContainer, pointOffset) === 0 && isBeforeVisibleEnd) {
            matchedBookmarkId = bookmark.id;
            break;
          }
        } catch {
          // A malformed or stale bookmark must not prevent toggling a valid one.
        }
      }
    }

    return {
      cfi,
      spineIndex,
      sectionFraction,
      pageNumber: this.pageCountCache ? this.getLocation().currentPage : null,
      layoutSignature: this.pageCountCache ? this.layoutSignature : null,
      chapterTitle: raw.tocItem?.label?.trim() || null,
      excerpt,
      matchedBookmarkId,
    };
  }

  locatePages(
    layoutSignature: string,
    targets: ReaderPageLocationTarget[],
    onUpdate: (batch: ReaderPageLocationResult[], done: boolean) => void,
  ) {
    const run = ++this.pageLocatorRun;
    const task = this.pageLocatorQueue.catch(() => undefined).then(async () => {
      const input = this.pageCountInput;
      const cache = this.pageCountCache;
      if (
        !input
        || !cache
        || !targets.length
        || layoutSignature !== this.layoutSignature
        || cache.layoutSignature !== layoutSignature
        || run !== this.pageLocatorRun
      ) {
        if (run === this.pageLocatorRun) onUpdate([], true);
        return;
      }

      const bounds = this.host.getBoundingClientRect();
      const measureHost = document.createElement('div');
      const locatorView = document.createElement('foliate-view') as FoliateView;
      let locatorOpen = false;
      const normalizeLocatorDocument = (event: Event) => {
        const detail = (event as CustomEvent<{ doc?: Document }>).detail;
        if (detail.doc) this.normalizeDocument(detail.doc);
      };
      try {
        Object.assign(measureHost.style, {
          position: 'fixed',
          left: `${-Math.max(3000, Math.round(bounds.width * 4))}px`,
          top: '0',
          width: `${Math.max(1, Math.round(bounds.width))}px`,
          height: `${Math.max(1, Math.round(bounds.height))}px`,
          overflow: 'hidden',
          visibility: 'hidden',
          pointerEvents: 'none',
          contain: 'layout style paint',
        });
        locatorView.style.display = 'block';
        locatorView.style.width = '100%';
        locatorView.style.height = '100%';
        locatorView.setAttribute('flow', 'paginated');
        locatorView.addEventListener('load', normalizeLocatorDocument);
        measureHost.append(locatorView);
        document.body.append(measureHost);

        const locatorBook = await this.createCounterBook(input);
        if (run !== this.pageLocatorRun || layoutSignature !== this.layoutSignature) return;
        normalizeBookStyles(locatorBook);
        await locatorView.open(locatorBook);
        locatorView.classList.toggle('reader-reflowable', !locatorView.isFixedLayout);
        locatorOpen = true;
        locatorView.renderer?.setAttribute('margin', READER_VERTICAL_MARGIN);
        locatorView.renderer?.setAttribute('gap', `${this.readerSettings.pageMargin}%`);
        await locatorView.init({ lastLocation: null, showTextStart: false });

        const uniqueTargets = Array.from(new Map(targets.map((target) => [target.destination, target])).values());
        const batch: ReaderPageLocationResult[] = [];
        for (let index = 0; index < uniqueTargets.length; index += 1) {
          if (run !== this.pageLocatorRun || layoutSignature !== this.layoutSignature) return;
          while (this.interactionState === 'turning') {
            if (run !== this.pageLocatorRun) return;
            await this.nextFrame();
          }
          const target = uniqueTargets[index];
          try {
            await locatorView.goTo(target.destination);
            await this.nextFrame();
            const spineIndex = locatorView.lastLocation?.section?.current;
            const sectionPage = locatorView.renderer?.page;
            if (typeof spineIndex !== 'number' || typeof sectionPage !== 'number') continue;
            const readableSectionPages = cache.sectionPages[spineIndex] ?? 0;
            // The global counter deliberately excludes non-linear spine
            // resources. It is better to omit a page label for those targets
            // than to present a number that the visible next/previous flow can
            // never reach. Also reject a stale/out-of-range renderer page.
            if (sectionPage < 1 || sectionPage > readableSectionPages) continue;
            const pageNumber = getGlobalReaderPage(cache.sectionPages, spineIndex, sectionPage);
            if (pageNumber > 0 && pageNumber <= cache.totalPages) {
              batch.push({ key: target.key, destination: target.destination, pageNumber });
            }
          } catch {
            // One invalid destination must not prevent other valid rows from resolving.
          }
          if (batch.length >= 12) {
            onUpdate(batch.splice(0), false);
            await this.nextIdleFrame();
          }
        }
        if (batch.length) onUpdate(batch, false);
        if (run === this.pageLocatorRun) onUpdate([], true);
      } finally {
        locatorView.removeEventListener('load', normalizeLocatorDocument);
        if (locatorOpen) locatorView.close();
        locatorView.remove();
        measureHost.remove();
      }
    });
    this.pageLocatorQueue = task.catch(() => undefined);
    return task;
  }

  cancelPageLocation() {
    this.pageLocatorRun += 1;
  }

  search(
    rawQuery: string,
    onUpdate: (batch: ReaderSearchResult[], progress: number | null, done: boolean) => void,
  ) {
    const query = rawQuery.trim();
    const run = ++this.searchRun;
    this.searchActive = true;
    const task = this.searchQueue.catch(() => undefined).then(async () => {
      const view = this.view;
      const sections = view?.book?.sections ?? [];
      if (!query || !view?.getCFI || !sections.length || run !== this.searchRun || !this.searchActive) return;
      const [{ searchMatcher }, { textWalker }] = await Promise.all([
        import('foliate-js/search.js'),
        import('foliate-js/text-walker.js'),
      ]);
      if (run !== this.searchRun || !this.searchActive) return;
      const matcher = searchMatcher(textWalker, {
        defaultLocale: view.language?.canonical ?? 'en',
        matchCase: false,
        matchDiacritics: false,
        matchWholeWords: false,
      });
      let resultIndex = 0;
      for (const [spineIndex, section] of sections.entries()) {
        if (run !== this.searchRun || !this.searchActive) break;
        if (!section.createDocument) {
          onUpdate([], (spineIndex + 1) / sections.length, false);
          continue;
        }
        const doc = await section.createDocument();
        if (run !== this.searchRun || !this.searchActive) break;
        const batch: ReaderSearchResult[] = [];
        for (const item of matcher(doc, query)) {
          if (run !== this.searchRun || !this.searchActive) break;
          resultIndex += 1;
          const cfi = view.getCFI(spineIndex, item.range);
          const chapterTitle = view.getProgressOf?.(spineIndex, item.range)?.tocItem?.label?.trim() || null;
          batch.push({
            id: `${run}-${spineIndex}-${resultIndex}`,
            cfi,
            spineIndex,
            chapterTitle,
            pageNumber: null,
            excerpt: {
              pre: item.excerpt.pre,
              match: item.excerpt.match,
              post: item.excerpt.post,
            },
          });
        }
        if (batch.length) onUpdate(batch, null, false);
        onUpdate([], (spineIndex + 1) / sections.length, false);
      }
      if (run === this.searchRun && this.searchActive) onUpdate([], 1, true);
    }).finally(() => {
      if (!this.searchActive) this.view?.clearSearch?.();
    });
    this.searchQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  cancelSearch() {
    this.searchRun += 1;
    this.searchActive = false;
    this.view?.clearSearch?.();
  }

  clearSelection() {
    for (const doc of this.loadedDocuments.keys()) doc.getSelection()?.removeAllRanges();
    this.clearActiveSelection(false);
  }

  async resolveExcerptAnchor(rangeCfi: string) {
    const view = this.view;
    const resolved = view?.resolveNavigation?.(rangeCfi);
    const sectionIndex = resolved?.index;
    if (typeof sectionIndex !== 'number' || !resolved?.anchor) throw new Error('无法解析摘录 CFI。');
    const loadedDocument = Array.from(this.loadedDocuments.entries())
      .find(([, loadedIndex]) => loadedIndex === sectionIndex)?.[0];
    const document = loadedDocument ?? await view?.book?.sections?.[sectionIndex]?.createDocument?.();
    if (!document) throw new Error('无法载入摘录所在章节。');
    const range = resolved.anchor(document);
    if (!this.isRangeLike(range)) throw new Error('摘录 CFI 没有恢复为文本 Range。');
    return { document, range, sectionIndex };
  }

  async verifyExcerptAnchors(items: ReaderExcerptVerificationItem[]) {
    if (!__DEV__ || items.length === 0) return;
    if (!this.view?.resolveNavigation) return;
    for (const item of items) {
      let resolvedText = '';
      let message: string | null = null;
      try {
        const { range } = await this.resolveExcerptAnchor(item.rangeCfi);
        resolvedText = range.toString().trim();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
      console.log('[EXCERPT_VERIFY]', JSON.stringify({
        excerptId: item.excerptId,
        match: message === null && normalize(resolvedText) === normalize(item.text),
        savedLength: item.text.length,
        resolvedLength: resolvedText.length,
        ...(message ? { message } : {}),
      }));
    }
  }

  // Permanent EPUB paint remains disabled. Excerpts persist text anchors only;
  // highlight and note rendering belong to later Annotation Core stages.
  addAnnotation() { throw new Error('高亮尚未启用。'); }
  removeAnnotation() { throw new Error('高亮尚未启用。'); }

  destroy() {
    if (this.view) this.onDiagnostic({ event: 'ENGINE_DESTROY' });
    this.restoreState = 'opening';
    this.interactionState = 'idle';
    this.pointerSession = null;
    this.pageTransitionActive = false;
    this.pendingPageTurn = null;
    this.rendererTouchCleanup?.();
    this.rendererTouchCleanup = null;
    this.pageCountRun += 1;
    this.cancelPageLocation();
    if (this.pageCountTimer !== null) window.clearTimeout(this.pageCountTimer);
    this.pageCountTimer = null;
    this.pageCountCache = null;
    this.layoutSignature = null;
    this.pageCountInput = null;
    this.settingsSessionActive = false;
    this.settingsSessionAnchorCfi = null;
    this.cancelSearch();
    this.selectedSearchHighlightCfi = null;
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
    this.resizeTimer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const cleanup of this.gestureCleanups.values()) cleanup();
    this.gestureCleanups.clear();
    for (const cleanup of this.selectionCleanups.values()) cleanup();
    this.selectionCleanups.clear();
    this.activeSelection = null;
    this.bookId = null;
    this.loadedDocuments.clear();
    if (this.view) {
      this.view.removeEventListener('relocate', this.handleRelocate);
      this.view.removeEventListener('load', this.handleDocumentLoad as EventListener);
      this.view.removeEventListener('draw-annotation', this.handleDrawAnnotation as EventListener);
      this.view.close();
      this.view.remove();
      this.view = null;
    }
    this.host.replaceChildren();
  }

  private readonly handleDrawAnnotation = (event: CustomEvent<{
    annotation?: { kind?: string };
    draw?: (drawer: typeof drawSearchResultHighlight, options?: object) => void;
  }>) => {
    if (event.detail?.annotation?.kind !== 'reader-search-result') return;
    event.detail.draw?.(drawSearchResultHighlight);
  };

  private async clearSelectedSearchHighlight() {
    const cfi = this.selectedSearchHighlightCfi;
    this.selectedSearchHighlightCfi = null;
    if (!cfi || !this.view?.deleteAnnotation) return;
    await this.view.deleteAnnotation({ kind: 'reader-search-result', value: cfi });
  }

  private readonly handleRelocate = () => {
    try {
      const location = this.getLocation();
      // A same-section turn normally resolves `view.next()` quickly. A
      // cross-spine turn can render the new section before that promise
      // settles, however. Relocation is foliate's authoritative signal that
      // the visible page is ready, so it must release the input lock here.
      if (this.interactionState === 'turning' && !this.pageTransitionActive) {
        this.interactionState = 'idle';
      }
      this.onLocation(location, this.restoreState);
    } catch {
      // A transient relocation without a CFI is not a persisted position.
    }
  };

  private readonly handleDocumentLoad = (event: CustomEvent<{ doc?: Document; index?: number }>) => {
    const doc = event.detail?.doc;
    const index = typeof event.detail?.index === 'number' ? event.detail.index : -1;
    if (!doc) return;
    // The paginated renderer owns one live section document. Release the old
    // iframe document as soon as foliate replaces it so listener maps never
    // retain every chapter visited during a long reading session.
    for (const loadedDoc of this.loadedDocuments.keys()) {
      if (loadedDoc === doc) continue;
      this.gestureCleanups.get(loadedDoc)?.();
      this.gestureCleanups.delete(loadedDoc);
      this.selectionCleanups.get(loadedDoc)?.();
      this.selectionCleanups.delete(loadedDoc);
      this.footnoteCleanups.get(loadedDoc)?.();
      this.footnoteCleanups.delete(loadedDoc);
      this.loadedDocuments.delete(loadedDoc);
    }
    if (this.activeSelection && this.activeSelection.doc !== doc) {
      this.activeSelection = null;
      if (this.interactionState === 'selecting') this.interactionState = 'idle';
      this.onSelectionChange(null);
    }
    if (!this.gestureCleanups.has(doc)) {
      this.normalizeDocument(doc);
      this.attachReaderGestures(doc, index);
    }
    if (!this.selectionCleanups.has(doc)) this.attachSelectionHandlers(doc, index);
    if (!this.footnoteCleanups.has(doc)) this.attachFootnoteHandlers(doc, index);
  };

  private attachReaderGestures(doc: Document, index: number) {
    // Gesture Reset: the document returned by this exact foliate section-load
    // event is the only Reader gesture owner for that document.
    this.loadedDocuments.set(doc, index);
    doc.addEventListener('pointerdown', this.handlePointerDown, true);
    doc.addEventListener('pointerup', this.handlePointerUp, true);
    doc.addEventListener('pointercancel', this.handlePointerCancel, true);
    // foliate 1.0.1 installs touchstart/move/end listeners on every document.
    // This first Tap-only phase must stop that entire independent pagination
    // path, otherwise its touchend snap competes with pointer-up page turns.
    const touchOptions = { capture: true, passive: false } as const;
    doc.addEventListener('touchstart', this.blockFoliateDocumentTouchPipeline, touchOptions);
    doc.addEventListener('touchmove', this.blockFoliateDocumentTouchPipeline, touchOptions);
    doc.addEventListener('touchend', this.blockFoliateDocumentTouchPipeline, touchOptions);
    doc.addEventListener('touchcancel', this.blockFoliateDocumentTouchPipeline, touchOptions);
    this.gestureCleanups.set(doc, () => {
      doc.removeEventListener('pointerdown', this.handlePointerDown, true);
      doc.removeEventListener('pointerup', this.handlePointerUp, true);
      doc.removeEventListener('pointercancel', this.handlePointerCancel, true);
      doc.removeEventListener('touchstart', this.blockFoliateDocumentTouchPipeline, true);
      doc.removeEventListener('touchmove', this.blockFoliateDocumentTouchPipeline, true);
      doc.removeEventListener('touchend', this.blockFoliateDocumentTouchPipeline, true);
      doc.removeEventListener('touchcancel', this.blockFoliateDocumentTouchPipeline, true);
    });
  }

  private attachSelectionHandlers(doc: Document, index: number) {
    let settleTimer: number | null = null;
    const settle = () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        this.publishSelection(doc, index);
      }, SELECTION_SETTLE_MS);
    };
    const onSelectionChange = () => {
      // Gesture arbitration is synchronous and does not wait for CFI
      // serialization or the Native bridge debounce.
      if (this.hasActiveSelection(doc) && this.interactionState !== 'turning') {
        this.interactionState = 'selecting';
      }
      settle();
    };
    const onPointerUp = () => settle();
    const onContextMenu = () => settle();
    doc.addEventListener('selectionchange', onSelectionChange);
    doc.addEventListener('pointerup', onPointerUp);
    doc.addEventListener('contextmenu', onContextMenu);
    this.selectionCleanups.set(doc, () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      doc.removeEventListener('selectionchange', onSelectionChange);
      doc.removeEventListener('pointerup', onPointerUp);
      doc.removeEventListener('contextmenu', onContextMenu);
    });
  }

  private hasActiveSelection(doc: Document) {
    const selection = doc.getSelection() ?? doc.defaultView?.getSelection();
    return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
  }

  // ── Footnote popover ────────────────────────────────────────────

  private attachFootnoteHandlers(doc: Document, index: number) {
    // One capture-phase click listener per section document: explicit event
    // ownership (preventDefault + stopPropagation) instead of timers.
    doc.addEventListener('click', this.handleFootnoteClick, true);
    this.footnoteCleanups.set(doc, () => {
      doc.removeEventListener('click', this.handleFootnoteClick, true);
    });
  }

  private readonly handleFootnoteClick = (event: MouseEvent) => {
    const doc = event.currentTarget as Document | null;
    // Consume the guard even when this click is not a footnote tap.
    const startedWithSelection = this.footnoteTapSelectionGuard;
    this.footnoteTapSelectionGuard = false;
    if (!doc || event.defaultPrevented) return;
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    // Priority: text selection > footnote. A tap that began with an active
    // selection (or still has one) keeps its historical behavior: the tap
    // dismisses the selection and the link is left untouched.
    if (startedWithSelection || this.hasActiveSelection(doc)) return;
    // A tap landing mid page-turn has a stale target rect; let it pass through.
    if (this.interactionState === 'turning') return;
    const ref = this.classifyFootnoteAnchor(doc, anchor);
    if (!ref) {
      this.logFootnoteCandidate(doc, anchor);
      // Backlink fallback: a "back to text" link whose fragment target does
      // not resolve (sloppy EPUBs) must not trigger a stray page jump.
      // Resolve it back to the citing noteref when possible, else swallow.
      if (this.handleDeadBacklink(doc, anchor, event)) return;
      return;
    }
    const anchorLabel = anchor.textContent ?? '';
    if (!ref.crossDocument && ref.targetElement) {
      // Never swallow a tap: if the footnote has no extractable content,
      // let the EPUB's default anchor navigation proceed untouched.
      if (!extractFootnoteContent(ref.targetElement, anchorLabel, anchor.getAttribute('id')).text) {
        if (__DEV__) console.log('[FOOTNOTE_EMPTY]', JSON.stringify({ rawHref: ref.rawHref }));
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    void this.openFootnotePopover(doc, anchor, ref);
  };

  /**
   * Backlink fallback for same-document "back to text" links whose fragment
   * target does not resolve (common in real-world EPUBs). Returns true when
   * the tap was consumed: either we redirected it to the citing noteref, or
   * there was nowhere sensible to go and the tap is swallowed instead of
   * letting the engine perform a stray page jump. Resolvable backlinks
   * return false so default navigation proceeds untouched.
   */
  private handleDeadBacklink(doc: Document, anchor: HTMLAnchorElement, event: MouseEvent): boolean {
    if (!isBacklinkAnchor(anchor)) return false;
    const rawHref = anchor.getAttribute('href')?.trim() ?? '';
    const hashIndex = rawHref.indexOf('#');
    // Cross-document backlinks keep default behavior (can't verify cheaply).
    if (hashIndex !== 0) return false;
    const fragment = decodeFootnoteFragment(rawHref.slice(1));
    if (fragment && findFragmentElement(doc, fragment)) return false;

    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    // Smart resolve: the backlink lives inside a footnote container; find a
    // noteref anchor elsewhere in the document that cites that container.
    const container = anchor.closest('aside[id], li[id], p[id], div[id], section[id]');
    const containerId = container?.getAttribute('id');
    if (container && containerId) {
      const cite = Array.from(doc.querySelectorAll('a[href]')).find((a) => {
        if (container.contains(a)) return false;
        const href = a.getAttribute('href') ?? '';
        if (!href.startsWith('#')) return false;
        return decodeFootnoteFragment(href.slice(1)) === containerId;
      }) as HTMLAnchorElement | undefined;
      if (cite) {
        let citeId = cite.getAttribute('id');
        if (!citeId) {
          citeId = `__pip-backlink-${containerId}`;
          cite.setAttribute('id', citeId);
        }
        if (__DEV__) console.log('[FOOTNOTE_BACKLINK_REDIRECT]', JSON.stringify({ rawHref, containerId }));
        consume();
        void this.view?.goTo(`#${citeId}`).catch(() => {});
        return true;
      }
    }
    if (__DEV__) console.log('[FOOTNOTE_BACKLINK_DEAD]', JSON.stringify({ rawHref }));
    consume();
    return true;
  }

  /**
   * Synchronous classification of a tapped anchor. Returns a footnote
   * reference only for semantically explicit footnotes; everything else
   * keeps its default link behavior.
   */
  private classifyFootnoteAnchor(doc: Document, anchor: HTMLAnchorElement): FootnoteReference | null {
    const rawHref = anchor.getAttribute('href')?.trim() ?? '';
    if (!rawHref || FOOTNOTE_EXTERNAL_SCHEME_RE.test(rawHref)) return null;
    const hashIndex = rawHref.indexOf('#');
    if (hashIndex < 0) return null;
    const fragment = decodeFootnoteFragment(rawHref.slice(hashIndex + 1));
    if (!fragment) return null;
    const rawPath = rawHref.slice(0, hashIndex);
    const book = this.view?.book;
    const sectionIndex = this.loadedDocuments.get(doc) ?? -1;
    const section = sectionIndex >= 0 ? book?.sections?.[sectionIndex] : undefined;
    const currentId = section?.id ?? null;
    let targetPath: string | null = null;
    if (!rawPath) {
      targetPath = currentId;
    } else {
      try {
        targetPath = section?.resolveHref ? section.resolveHref(rawPath) : null;
      } catch {
        targetPath = null;
      }
    }
    if (!targetPath) return null;
    const crossDocument = targetPath !== currentId;
    const anchorEpubType = anchor.getAttribute('epub:type');
    const anchorRole = anchor.getAttribute('role');
    const isExplicitNoteref = anchorEpubType === 'noteref' || anchorRole === 'doc-noteref';
    const anchorSemanticType: FootnoteSemanticType = anchorEpubType === 'noteref'
      ? 'noteref'
      : anchorRole === 'doc-noteref'
        ? 'doc-noteref'
        : 'footnote-target';

    if (!crossDocument) {
      const targetElement = findFragmentElement(doc, fragment);
      if (isExplicitNoteref) {
        if (!targetElement) {
          // Explicit noteref with an unresolvable target: fall back to the
          // EPUB's default navigation instead of swallowing the tap.
          if (__DEV__) console.log('[FOOTNOTE_TARGET_MISSING]', JSON.stringify({ rawHref, sectionIndex }));
          return null;
        }
        return { rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref, semanticType: anchorSemanticType, targetElement };
      }
      if (targetElement && isFootnoteTargetElement(targetElement)) {
        return { rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref, semanticType: getFootnoteSemanticType(targetElement)!, targetElement };
      }
      // Heuristic fallback (v2): non-semantic links that look like footnote
      // references (plain `<a href="#fn1">1</a>` in real-world books). The
      // empty-content guard in the click handler still applies, so a tap is
      // never swallowed when nothing extractable exists.
      const body = targetElement ? resolveFootnoteBody(targetElement) : null;
      if (body && isHeuristicFootnoteReference(anchor, body)) {
        if (__DEV__) console.log('[FOOTNOTE_HEURISTIC]', JSON.stringify({ rawHref, sectionIndex }));
        return { rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref, semanticType: 'heuristic', targetElement: body };
      }
      return null;
    }

    // Cross-document v1: intercept only explicit noteref anchors (the stable
    // standard path). Other cross-document links keep default behavior.
    if (!isExplicitNoteref) return null;
    return { rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref, semanticType: anchorSemanticType, targetElement: null };
  }

  private async openFootnotePopover(doc: Document, anchor: HTMLAnchorElement, ref: FootnoteReference): Promise<void> {
    const book = this.view?.book;
    let targetElement: Element | null = ref.targetElement;
    if (ref.crossDocument) {
      let targetDoc: Document | null = null;
      try {
        // Preferred: foliate's public path — resolve the target through the
        // book and let its section parse an offscreen document. No manual
        // unzip/re-parse, no interference with the live view.
        const resolvedIndex = book?.resolveHref?.(ref.targetPath)?.index;
        const targetSection = typeof resolvedIndex === 'number' && resolvedIndex >= 0
          ? book?.sections?.[resolvedIndex]
          : undefined;
        if (targetSection?.createDocument) {
          targetDoc = await targetSection.createDocument();
        } else {
          // The target is in the manifest but not in the spine (the typical
          // endnotes document). Fall back to raw text + the book's parser.
          const text = await book?.loadText?.(ref.targetPath);
          if (!text) throw new Error('empty footnote document');
          const parser = book?.parser ?? new DOMParser();
          targetDoc = parser.parseFromString(text, 'application/xhtml+xml');
          if (targetDoc.querySelector('parsererror')) {
            // Non-spine notes documents are occasionally plain HTML.
            targetDoc = parser.parseFromString(text, 'text/html');
          }
        }
      } catch {
        if (__DEV__) console.log('[FOOTNOTE_RESOLVE_FAILED]', JSON.stringify({ rawHref: ref.rawHref }));
      }
      targetElement = targetDoc ? findFragmentElement(targetDoc, ref.fragment) : null;
      if (!targetElement) {
        if (__DEV__) console.log('[FOOTNOTE_TARGET_MISSING]', JSON.stringify({ rawHref: ref.rawHref, crossDocument: true }));
        // Fallback: the EPUB's natural navigation to the resolved target.
        try {
          await this.view?.goTo(`${ref.targetPath}#${ref.fragment}`);
        } catch {
          // The reader stays where it is; the tap was at least not swallowed silently.
        }
        return;
      }
    }
    if (!targetElement) return;
    // The cross-document path awaits I/O above; the reader may have paginated
    // meanwhile. Never open a popover against a detached anchor rect.
    if (!anchor.isConnected) {
      if (__DEV__) console.log('[FOOTNOTE_ANCHOR_GONE]', JSON.stringify({ rawHref: ref.rawHref }));
      return;
    }
    const { text, richText, html } = extractFootnoteContent(targetElement, anchor.textContent ?? '', anchor.getAttribute('id'));
    if (!text) {
      if (__DEV__) console.log('[FOOTNOTE_EMPTY]', JSON.stringify({ rawHref: ref.rawHref, crossDocument: ref.crossDocument }));
      // Fallback: the EPUB's natural navigation to the resolved target, so
      // the tap is never swallowed silently.
      try {
        await this.view?.goTo(`${ref.targetPath}#${ref.fragment}`);
      } catch {
        // The reader stays where it is.
      }
      return;
    }
    const anchorRect = this.mapIframeRectToWebView(anchor.getBoundingClientRect(), doc);
    const payload: FootnotePayload = {
      id: ref.fragment,
      text,
      richText,
      html,
      sourceHref: ref.rawHref,
      anchorRect,
      crossDocument: ref.crossDocument,
      semanticType: ref.semanticType,
    };
    if (__DEV__) {
      console.log('[FOOTNOTE_OPEN]', JSON.stringify({
        sectionIndex: ref.sectionIndex,
        sourceHref: ref.rawHref,
        targetHref: `${ref.targetPath}#${ref.fragment}`,
        semanticType: ref.semanticType,
        anchorRect,
        contentLength: text.length,
        crossDocument: ref.crossDocument,
      }));
    }
    this.onFootnoteOpen(payload);
  }

  /**
   * DEV-only record of plausible-but-non-semantic footnote markers
   * (`<a href="#fn1"><sup>1</sup></a>` with no footnote semantics). Never
   * intercepted in v1; the log fuels future compatibility heuristics.
   */
  private logFootnoteCandidate(doc: Document, anchor: HTMLAnchorElement): void {
    if (!__DEV__) return;
    // Explicit noterefs are already covered by [FOOTNOTE_TARGET_MISSING];
    // candidates are the non-semantic markers we deliberately don't intercept.
    if (anchor.getAttribute('epub:type') === 'noteref' || anchor.getAttribute('role') === 'doc-noteref') return;
    const rawHref = anchor.getAttribute('href')?.trim() ?? '';
    if (!rawHref.startsWith('#')) return;
    const label = (anchor.textContent ?? '').trim();
    if (label === '' || label.length > 4 || !FOOTNOTE_LEADING_NUMBER_RE.test(label)) return;
    const fragment = decodeFootnoteFragment(rawHref.slice(1));
    if (!fragment) return;
    const target = findFragmentElement(doc, fragment);
    if (!target) return;
    console.log('[FOOTNOTE_CANDIDATE]', JSON.stringify({
      href: rawHref,
      targetTag: target.tagName.toLowerCase(),
      targetClass: (target as HTMLElement).className ?? '',
      targetTextPreview: (target.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    }));
  }

  /**
   * Map an iframe-local rect (e.g. anchor.getBoundingClientRect()) into the
   * WebView's CSS-pixel space. Same mapping the selection bubble uses.
   *
   * The returned rect is in **native window points** (== RN
   * `Dimensions.get('window')` points), not just WebView-local:
   * - `frameElement.getBoundingClientRect()` is relative to the host
   *   document viewport, i.e. the WKWebView viewport origin.
   * - The Expo DOM host view is `flex: 1` directly inside the Reader root
   *   view, which is `flex: 1` at window origin (0,0) (`headerShown: false`,
   *   no transform, no margin/padding) — so the WebView viewport origin
   *   coincides with the window origin.
   * - WKWebView maps DOM CSS px 1:1 to UIKit points (no page zoom); the
   *   measured scale below is iframe→host-document CSS px scale for
   *   foliate's column layout, NOT a device-pixel scale.
   * - `getBoundingClientRect()` is already post-transform, so foliate's
   *   pagination transforms are accounted for exactly once, here.
   *
   * Do not add safe-area offsets here; window conversion already includes
   * them. Do not pass DOM-local or Reader-local coordinates to native —
   * this rect is final.
   */
  private mapIframeRectToWebView(rect: { left: number; top: number; right: number; bottom: number }, doc: Document): FootnoteAnchorRect {
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    const frameRect = frame?.getBoundingClientRect();
    const viewportWidth = doc.defaultView?.innerWidth || frame?.clientWidth || 1;
    const viewportHeight = doc.defaultView?.innerHeight || frame?.clientHeight || 1;
    const measuredScaleX = frameRect && frame?.clientWidth ? frameRect.width / frame.clientWidth : NaN;
    const measuredScaleY = frameRect && frame?.clientHeight ? frameRect.height / frame.clientHeight : NaN;
    const scaleX = Number.isFinite(measuredScaleX) ? measuredScaleX : frameRect ? frameRect.width / viewportWidth : 1;
    const scaleY = Number.isFinite(measuredScaleY) ? measuredScaleY : frameRect ? frameRect.height / viewportHeight : 1;
    return {
      x: (frameRect?.left ?? 0) + rect.left * scaleX,
      y: (frameRect?.top ?? 0) + rect.top * scaleY,
      width: Math.max(0, rect.right - rect.left) * scaleX,
      height: Math.max(0, rect.bottom - rect.top) * scaleY,
    };
  }

  private clearActiveSelection(removeNativeRange: boolean) {
    const active = this.activeSelection;
    if (!active) return;
    if (removeNativeRange) active.doc.getSelection()?.removeAllRanges();
    this.activeSelection = null;
    if (this.interactionState === 'selecting') this.interactionState = 'idle';
    this.onSelectionChange(null);
  }

  private publishSelection(doc: Document, index: number) {
    const payload = this.readSelection(doc, index);
    if (!payload) {
      if (this.activeSelection?.doc === doc) {
        this.activeSelection = null;
        if (this.interactionState === 'selecting') this.interactionState = 'idle';
        this.onSelectionChange(null);
      }
      return;
    }
    const previous = this.activeSelection?.payload;
    this.activeSelection = { doc, payload };
    this.interactionState = 'selecting';
    if (previous?.rangeCfi !== payload.rangeCfi || previous.text !== payload.text) {
      this.onSelectionChange(payload);
      this.verifySelectionAnchor(doc, payload);
    }
  }

  private readSelection(doc: Document, index: number): ReaderSelectionPayload | null {
    const view = this.view;
    const bookId = this.bookId;
    const selection = doc.getSelection() ?? doc.defaultView?.getSelection();
    if (!view?.getCFI || !bookId || !selection || selection.rangeCount < 1 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0).cloneRange();
    if (!doc.body?.contains(range.startContainer) || !doc.body.contains(range.endContainer)) return null;
    const startElement = this.getSelectionElement(range.startContainer);
    const endElement = this.getSelectionElement(range.endContainer);
    const excludedSelector = 'button, input, select, textarea, [role="button"], [contenteditable="true"], [data-reader-ui]';
    if (startElement?.closest(excludedSelector) || endElement?.closest(excludedSelector)) return null;
    const text = range.toString().trim();
    if (!text) return null;
    try {
      const start = range.cloneRange();
      start.collapse(true);
      const end = range.cloneRange();
      end.collapse(false);
      const rangeCfi = view.getCFI(index, range);
      const startCfi = view.getCFI(index, start);
      const endCfi = view.getCFI(index, end);
      if (![rangeCfi, startCfi, endCfi].every((value) => value.startsWith('epubcfi('))) return null;
      return {
        bookId,
        text,
        startCfi,
        endCfi,
        rangeCfi,
        chapterTitle: view.getProgressOf?.(index, range)?.tocItem?.label?.trim() || null,
        sectionIndex: index,
        rect: this.getSelectionRect(doc, range),
      };
    } catch (error) {
      if (__DEV__) console.warn('[SELECTION_CFI_FAILED]', error);
      return null;
    }
  }

  private getSelectionElement(node: Node) {
    return node.nodeType === 1 ? node as Element : node.parentElement;
  }

  private getSelectionRect(doc: Document, range: Range): ReaderSelectionRect {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    const rangeRect = rects.length > 0 ? rects.reduce((union, rect) => ({
      left: Math.min(union.left, rect.left),
      top: Math.min(union.top, rect.top),
      right: Math.max(union.right, rect.right),
      bottom: Math.max(union.bottom, rect.bottom),
    }), { left: rects[0].left, top: rects[0].top, right: rects[0].right, bottom: rects[0].bottom }) : range.getBoundingClientRect();
    return this.mapIframeRectToWebView(rangeRect, doc);
  }

  private verifySelectionAnchor(doc: Document, payload: ReaderSelectionPayload) {
    if (!__DEV__) return;
    try {
      const resolved = this.view?.resolveNavigation?.(payload.rangeCfi);
      const resolvedRange = resolved?.anchor?.(doc);
      const resolvedText = this.isRangeLike(resolvedRange) ? resolvedRange.toString().trim() : '';
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
      console.log('[SELECTION_VERIFY]', JSON.stringify({
        match: normalize(resolvedText) === normalize(payload.text),
        expectedLength: payload.text.length,
        resolvedLength: resolvedText.length,
      }));
    } catch (error) {
      console.warn('[SELECTION_VERIFY]', JSON.stringify({ match: false, message: error instanceof Error ? error.message : String(error) }));
    }
  }

  private isRangeLike(value: Range | Element | number | null | undefined): value is Range {
    return Boolean(value && typeof value === 'object' && 'startContainer' in value && 'endContainer' in value && 'toString' in value);
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    const doc = event.currentTarget as Document;
    if (!event.isPrimary || this.reflowing) return;
    const startedWhileTurning = this.interactionState === 'turning';
    this.pointerSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startedAt: event.timeStamp,
      target: event.target,
      selectionWasActive: this.hasActiveSelection(doc),
      startedWhileTurning,
    };
    // Footnote taps must not fire when the tap began with an active selection.
    this.footnoteTapSelectionGuard = this.hasActiveSelection(doc);
    if (!startedWhileTurning) {
      this.interactionState = this.hasActiveSelection(doc) ? 'selecting' : 'pointerDown';
    }
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    const session = this.pointerSession;
    if (!event.isPrimary || !session || session.pointerId !== event.pointerId) return;
    const doc = event.currentTarget as Document;
    this.pointerSession = null;
    const movement = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    const screenDeltaX = event.screenX - session.startScreenX;
    const screenDeltaY = event.screenY - session.startScreenY;
    const duration = event.timeStamp - session.startedAt;
    const selectionActive = this.hasActiveSelection(doc);
    const target = session.target instanceof Element ? session.target : null;
    const interactiveTarget = Boolean(target?.closest('a, button, input, select, textarea, [role="button"], [contenteditable="true"], audio, video'));
    const contentWidth = doc.defaultView?.innerWidth ?? doc.documentElement.clientWidth;
    // Expo DOM/WebKit reports clientX in the EPUB's scaled column canvas
    // (for example 2,056px on a 430px iPhone page). `screenX` and `screen.width`
    // are both sourced from this loaded iframe's Window and remain in the
    // visible-page coordinate space. Prefer that matched pair for hit testing.
    const screenWidth = doc.defaultView?.screen?.width ?? 0;
    const hitTestX = screenWidth > 0 ? event.screenX : event.clientX;
    const hitTestWidth = screenWidth > 0 ? screenWidth : contentWidth;
    const ratio = hitTestWidth && Number.isFinite(hitTestX)
      ? Math.max(0, Math.min(1, hitTestX / hitTestWidth))
      : null;
    const zone = ratio === null ? 'unknown' : ratio <= TAP_EDGE_RATIO ? 'left' : ratio >= 1 - TAP_EDGE_RATIO ? 'right' : 'center';
    const blockedByState = this.reflowing;
    const isTap = movement < TAP_MAX_MOVEMENT_PX && duration < TAP_MAX_DURATION_MS;
    const isHorizontalSwipe = Math.abs(screenDeltaX) >= SWIPE_MIN_DISTANCE_PX
      && Math.abs(screenDeltaX) > Math.abs(screenDeltaY) * SWIPE_DIRECTION_DOMINANCE;
    const requestedAction = session.selectionWasActive || selectionActive || interactiveTarget || blockedByState || !this.view || this.restoreState !== 'active'
      ? 'none'
      : isHorizontalSwipe ? screenDeltaX < 0 ? 'next' : 'prev'
      : isTap ? zone === 'left' ? 'prev' : zone === 'right' ? 'next' : 'chrome'
      : 'none';
    const turnInFlight = session.startedWhileTurning || this.interactionState === 'turning';
    const action = turnInFlight && (requestedAction === 'next' || requestedAction === 'prev')
      ? `queued-${requestedAction}`
      : turnInFlight
        ? 'none'
        : requestedAction;
    if (action === 'queued-next' || action === 'queued-prev') {
      const direction = action === 'queued-next' ? 'next' : 'prev';
      void this.requestPageTurn(direction);
      return;
    }
    if (turnInFlight) return;
    this.interactionState = 'idle';
    if (action === 'chrome') this.onCenterTap();
    else if (action === 'prev' || action === 'next') {
      void this.requestPageTurn(action);
    }
  };

  private readonly handlePointerCancel = (event: PointerEvent) => {
    if (this.pointerSession?.pointerId !== event.pointerId) return;
    this.pointerSession = null;
    if (this.interactionState !== 'turning') this.interactionState = 'idle';
  };

  private readonly blockFoliateDocumentTouchPipeline = (event: TouchEvent) => {
    // Stop foliate 1.0.1's paginator-level touch handlers, but deliberately do
    // not prevent WebKit's default action. iOS owns long-press selection,
    // magnification, handles, and the native edit menu.
    event.stopImmediatePropagation();
  };

  private readonly blockFoliateRendererTouchPipeline = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  };

  private attachRendererTouchBlocker(renderer: FoliateRenderer | undefined) {
    this.rendererTouchCleanup?.();
    this.rendererTouchCleanup = null;
    if (!renderer) return;
    renderer.removeAttribute('animated');
    renderer.style.touchAction = 'none';
    const touchOptions = { capture: true, passive: false } as const;
    renderer.addEventListener('touchstart', this.blockFoliateRendererTouchPipeline, touchOptions);
    renderer.addEventListener('touchmove', this.blockFoliateRendererTouchPipeline, touchOptions);
    renderer.addEventListener('touchend', this.blockFoliateRendererTouchPipeline, touchOptions);
    renderer.addEventListener('touchcancel', this.blockFoliateRendererTouchPipeline, touchOptions);
    this.rendererTouchCleanup = () => {
      renderer.removeEventListener('touchstart', this.blockFoliateRendererTouchPipeline, true);
      renderer.removeEventListener('touchmove', this.blockFoliateRendererTouchPipeline, true);
      renderer.removeEventListener('touchend', this.blockFoliateRendererTouchPipeline, true);
      renderer.removeEventListener('touchcancel', this.blockFoliateRendererTouchPipeline, true);
      renderer.style.removeProperty('touch-action');
    };
  }

  private async requestPageTurn(direction: 'next' | 'prev') {
    if (!this.view || this.restoreState !== 'active' || this.reflowing) return;
    if (this.interactionState === 'turning') {
      this.queuePageTurn({ direction });
      return;
    }
    // `renderer.atStart` / `atEnd` is transiently stale when foliate has just
    // crossed a spine boundary. Let foliate's own next/prev own that boundary
    // decision; it safely no-ops at the actual start/end of the whole book.
    this.interactionState = 'turning';
    this.pendingPageTurn = null;
    // Removing a temporary search marker must never add input latency to the
    // established page-turn pipeline.
    void this.clearSelectedSearchHighlight();
    let nextDirection: 'next' | 'prev' | null = direction;
    try {
      // Keep the lock for the entire burst. Starting a new View Transition
      // recursively in the same task that completed the previous one could
      // race WebKit's snapshot cleanup and intermittently drop frames.
      while (nextDirection) {
        await this.turnWithCrossDissolve(nextDirection);
        const pendingTurn = this.takePendingPageTurn();
        if (!pendingTurn) break;
        await this.nextFrame();
        nextDirection = pendingTurn.direction;
      }
    } finally {
      this.pageTransitionActive = false;
      this.interactionState = 'idle';
      this.pendingPageTurn = null;
    }
  }

  private queuePageTurn(turn: PendingPageTurn) {
    // One latest-intent buffer makes rapid swipes feel continuous while still
    // guaranteeing that a single transition owns exactly one frozen snapshot.
    this.pendingPageTurn = turn;
  }

  private takePendingPageTurn() {
    const pendingTurn: PendingPageTurn | null = this.pendingPageTurn;
    this.pendingPageTurn = null;
    return pendingTurn;
  }

  private async turnWithCrossDissolve(direction: 'next' | 'prev') {
    const view = this.view;
    if (!view) return;
    const turn = async () => {
      await (direction === 'next' ? view.next() : view.prev());
      // Do not await requestAnimationFrame in this callback. iOS WebKit
      // pauses frame production until a View Transition update callback
      // resolves, so doing so creates a self-wait and eventually throws
      // “View transition update callback timed out”. `view.next()` remains
      // the authoritative settled relocation before the two snapshots are
      // composed for the simultaneous CSS dissolve.
    };
    const transitionDocument = document as ViewTransitionDocument;
    const startViewTransition = transitionDocument.startViewTransition;
    if (this.prefersReducedMotion() || !startViewTransition) {
      await turn();
      return;
    }
    // The named foliate-view is captured by View Transitions *before* `turn`
    // runs. `::view-transition-old(reader-page)` is therefore a frozen A-page
    // bitmap, never a reference to the live foliate DOM that later becomes B.
    this.pageTransitionActive = true;
    const transition = startViewTransition.call(document, turn);
    try {
      await transition.finished;
    } catch {
      // The page relocation itself remains authoritative. A WebKit visual
      // transition may be cancelled by lifecycle changes without invalidating
      // the completed foliate turn.
    } finally {
      this.pageTransitionActive = false;
    }
  }

  private fadeOut() {
    const view = this.view;
    if (!view) return;
    view.style.transition = `opacity ${this.prefersReducedMotion() ? 40 : 60}ms ease-out`;
    view.style.opacity = '0.32';
  }

  private async fadeIn() {
    const view = this.view;
    if (!view) return;
    const duration = this.prefersReducedMotion() ? 55 : 90;
    view.style.transition = `opacity ${duration}ms ease-in`;
    view.style.opacity = '1';
    await this.waitForOpacityTransition(duration);
  }

  private waitForOpacityTransition(duration: number) {
    const view = this.view;
    if (!view) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let complete = false;
      const finish = () => {
        if (complete) return;
        complete = true;
        view.removeEventListener('transitionend', onTransitionEnd);
        window.clearTimeout(fallback);
        resolve();
      };
      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.propertyName === 'opacity') finish();
      };
      const fallback = window.setTimeout(finish, duration + 60);
      view.addEventListener('transitionend', onTransitionEnd);
    });
  }

  private prefersReducedMotion() {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private nextFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  private installViewportObserver() {
    if (!globalThis.ResizeObserver) return;
    this.resizeObserver?.disconnect();
    let width = 0;
    let height = 0;
    this.resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      if (!width || !height) {
        width = nextWidth;
        height = nextHeight;
        return;
      }
      if (Math.abs(width - nextWidth) < 2 && Math.abs(height - nextHeight) < 2) return;
      width = nextWidth;
      height = nextHeight;
      if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.resizeTimer = null;
        void this.restoreAfterViewportChange();
      }, 120);
    });
    this.resizeObserver.observe(this.host);
  }

  private async restoreAfterViewportChange() {
    if (!this.view || this.restoreState !== 'active') return;
    if (this.interactionState === 'turning' || this.reflowing) {
      if (this.resizeTimer === null) {
        this.resizeTimer = window.setTimeout(() => {
          this.resizeTimer = null;
          void this.restoreAfterViewportChange();
        }, 120);
      }
      return;
    }
    let cfi: string;
    try {
      cfi = this.getLocation().cfi;
    } catch {
      return;
    }
    this.reflowing = true;
    this.restoreState = 'restoring';
    const nextLayoutSignature = this.createLayoutSignature();
    if (nextLayoutSignature !== this.layoutSignature) {
      // A cached total belongs to one exact pagination geometry. Do not reuse
      // it after a rotation or host-size change; the background counter will
      // replace it without delaying the reflowed page.
      this.layoutSignature = nextLayoutSignature;
      this.pageCountCache = null;
      this.pageCountRun += 1;
      this.cancelPageLocation();
      if (this.pageCountTimer !== null) window.clearTimeout(this.pageCountTimer);
      this.pageCountTimer = null;
    }
    this.fadeOut();
    try {
      await this.nextFrame();
      await this.view.goTo(cfi);
      await this.nextFrame();
      const location = this.getLocation();
      this.restoreState = 'active';
      this.onLocation(location, this.restoreState);
      this.scheduleBackgroundPageCount();
    } finally {
      this.restoreState = 'active';
      this.reflowing = false;
      await this.fadeIn();
    }
  }

  private async applySettingsInternal(nextSettings: ReaderSettings, sessionAnchorCfi: string | null) {
    const previousSettings = this.readerSettings;
    if (readerSettingsEqual(previousSettings, nextSettings)) return;
    const selectionToVerify = this.activeSelection?.payload ?? null;
    const layoutChanged = !readerLayoutSettingsEqual(previousSettings, nextSettings);
    const appearanceChanged = previousSettings.appearance !== nextSettings.appearance;
    this.readerSettings = nextSettings;
    if (this.pageCountInput) {
      this.pageCountInput = { ...this.pageCountInput, readerSettings: nextSettings };
    }
    if (appearanceChanged) {
      this.applyReaderAppearanceToHost();
      for (const doc of this.loadedDocuments.keys()) this.applyReaderStyles(doc);
    }
    // Appearance and page-turn mode do not change font metrics or paginator
    // geometry. Apply them immediately without CFI capture, goTo(), cache
    // invalidation, or a background page recount.
    if (!layoutChanged) return;

    const view = this.view;
    if (!view || view.isFixedLayout) return;
    let cfi: string;
    try {
      cfi = sessionAnchorCfi ?? this.getLocation().cfi;
    } catch {
      return;
    }

    this.reflowing = true;
    this.restoreState = 'restoring';
    this.pageCountCache = null;
    this.pageCountRun += 1;
    this.cancelPageLocation();
    if (this.pageCountTimer !== null) window.clearTimeout(this.pageCountTimer);
    this.pageCountTimer = null;
    try {
      for (const doc of this.loadedDocuments.keys()) this.applyReaderStyles(doc);
      view.renderer?.setAttribute('gap', `${nextSettings.pageMargin}%`);
      this.layoutSignature = this.createLayoutSignature();
      await this.nextFrame();
      await view.goTo(cfi);
      await this.nextFrame();
      if (selectionToVerify) {
        const selectionDoc = Array.from(this.loadedDocuments.entries())
          .find(([, index]) => index === selectionToVerify.sectionIndex)?.[0];
        if (selectionDoc) this.verifySelectionAnchor(selectionDoc, selectionToVerify);
      }
      const location = this.getLocation();
      this.restoreState = 'active';
      this.onLocation(location, this.restoreState);
      this.scheduleBackgroundPageCount();
    } finally {
      this.restoreState = 'active';
      this.reflowing = false;
    }
  }

  private createLayoutSignature() {
    const bounds = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    // Keep all reflow-affecting values explicit. Settings can extend this
    // string later, automatically producing a distinct cache row.
    // v2 uses foliate's actual readable-column count (`pages - 2`) instead
    // of its internal viewport count. Changing the version deliberately
    // ignores v1 rows, which over-counted every spine section.
    return `foliate-paginated:v4:${width}x${height}:top=${READER_CONTENT_TOP_PX}:bottom=${READER_CONTENT_BOTTOM_PX}:gap=${this.readerSettings.pageMargin}:font=apple-system:size=${this.readerSettings.fontSize}:weight=500:line=${this.readerSettings.lineHeight}:tracking=${this.readerSettings.letterSpacing}:image-normalize=standalone-v3`;
  }

  private isCacheUsable(cache: ReaderPageCountCache | null, layoutSignature: string) {
    return Boolean(
      cache
      && cache.layoutSignature === layoutSignature
      && cache.totalPages > 0
      && cache.sectionPages.length > 0,
    );
  }

  private scheduleBackgroundPageCount(input = this.pageCountInput) {
    if (!input || this.settingsSessionActive || this.pageCountCache || this.pageCountTimer !== null || this.restoreState !== 'active') return;
    const run = ++this.pageCountRun;
    // First paint and CFI restoration always win. A short quiet window keeps
    // this optional work out of the open path and lets an immediate first turn
    // remain responsive.
    this.pageCountTimer = window.setTimeout(() => {
      this.pageCountTimer = null;
      void this.countPagesInBackground(input, run);
    }, 900);
  }

  private async countPagesInBackground(input: FoliateOpenInput, run: number) {
    if (!this.view || this.restoreState !== 'active' || this.pageCountCache || run !== this.pageCountRun) return;
    const signature = this.layoutSignature;
    if (!signature) return;
    const bounds = this.host.getBoundingClientRect();
    const measureHost = document.createElement('div');
    const counterView = document.createElement('foliate-view') as FoliateView;
    let counterOpen = false;
    const normalizeCounterDocument = (event: Event) => {
      const detail = (event as CustomEvent<{ doc?: Document }>).detail;
      if (detail.doc) this.normalizeDocument(detail.doc);
    };
    try {
      Object.assign(measureHost.style, {
        position: 'fixed',
        left: `${-Math.max(3000, Math.round(bounds.width * 4))}px`,
        top: '0',
        width: `${Math.max(1, Math.round(bounds.width))}px`,
        height: `${Math.max(1, Math.round(bounds.height))}px`,
        overflow: 'hidden',
        visibility: 'hidden',
        pointerEvents: 'none',
        contain: 'layout style paint',
      });
      counterView.style.display = 'block';
      counterView.style.width = '100%';
      counterView.style.height = '100%';
      counterView.setAttribute('flow', 'paginated');
      counterView.addEventListener('load', normalizeCounterDocument);
      measureHost.append(counterView);
      document.body.append(measureHost);

      const counterBook = await this.createCounterBook(input);
      if (run !== this.pageCountRun || this.restoreState !== 'active') return;
      normalizeBookStyles(counterBook);
      await counterView.open(counterBook);
      counterView.classList.toggle('reader-reflowable', !counterView.isFixedLayout);
      counterOpen = true;
      counterView.renderer?.setAttribute('margin', READER_VERTICAL_MARGIN);
      counterView.renderer?.setAttribute('gap', `${this.readerSettings.pageMargin}%`);
      await counterView.init({ lastLocation: null, showTextStart: false });

      const sectionPages = new Array(counterView.book?.sections?.length ?? 0).fill(0) as number[];
      for (let index = 0; index < sectionPages.length; index += 1) {
        if (run !== this.pageCountRun || this.restoreState !== 'active') return;
        // The visible page turn always wins over the optional offscreen
        // paginator. Pause between sections for an entire rapid-turn burst so
        // its layout work cannot compete with View Transition snapshots.
        if (!await this.waitForVisibleTurnIdle(run)) return;
        // Yield between small batches, rather than after every XHTML file.
        // A large omnibus can contain hundreds of tiny spine entries; the old
        // one-file-per-idle pacing made an otherwise valid total take over a
        // minute and it was usually cancelled when the reader closed.
        if (index > 0 && index % PAGE_COUNT_BATCH_SIZE === 0) await this.nextIdleFrame();
        await counterView.goTo(index);
        // foliate resolves goTo only after the paginator has laid out the
        // target section. One frame is sufficient for WebKit to expose the
        // measured page count; two frames per section were pure delay.
        await this.nextFrame();
        const paginatorPages = counterView.renderer?.pages;
        const isLinear = counterView.book?.sections?.[index]?.linear !== 'no';
        // paginator.pages includes a non-readable leading and trailing
        // relocation column. This is visible in foliate's own paginator:
        // its fraction and anchor math use `pages - 2`. Counting the raw
        // value was why a chapter ending at 221 reopened at 224. Keep one
        // page for extremely short sections, which cannot have a negative
        // readable count.
        // `view.next()` also skips `linear="no"` spine entries. Their
        // contribution must therefore be zero in the global display counter.
        sectionPages[index] = isLinear && typeof paginatorPages === 'number' && paginatorPages > 0
          ? Math.max(1, paginatorPages - 2)
          : 0;
      }
      const totalPages = sectionPages.reduce((sum, pages) => sum + pages, 0);
      if (!totalPages || run !== this.pageCountRun || this.restoreState !== 'active') return;
      const result: ReaderPageCountResult = { layoutSignature: signature, totalPages, sectionPages };
      this.pageCountCache = { ...result, bookId: input.bookId, updatedAt: new Date().toISOString() };
      this.onPageCount(result);
    } catch (error) {
      console.warn('[PAGE_COUNT_FAILED]', error);
    } finally {
      counterView.removeEventListener('load', normalizeCounterDocument);
      if (counterOpen) counterView.close();
      counterView.remove();
      measureHost.remove();
    }
  }

  private async createCounterBook(input: FoliateOpenInput): Promise<FoliateBook> {
    if (input.sourceKind === 'zip-resource-loader') return createOnDemandBook(input);
    const { makeBook } = await import('foliate-js/view.js');
    return makeBook(new File([base64ToBytes(input.base64 ?? '')], input.fileName, { type: 'application/epub+zip' })) as Promise<FoliateBook>;
  }

  private async waitForVisibleTurnIdle(run: number) {
    while (this.interactionState === 'turning') {
      if (run !== this.pageCountRun || this.restoreState !== 'active') return false;
      await this.nextFrame();
    }
    return run === this.pageCountRun && this.restoreState === 'active';
  }

  private nextIdleFrame() {
    const requestIdle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (requestIdle) return new Promise<void>((resolve) => { requestIdle(resolve, { timeout: 350 }); });
    return new Promise<void>((resolve) => { window.setTimeout(resolve, 48); });
  }

  private normalizeDocument(doc: Document) {
    // Preserve an EPUB's declared language. Chinese is only the fallback for
    // books that omit it; native edit-menu localization comes from the app
    // bundle declaration rather than falsifying valid EPUB language metadata.
    doc.documentElement.lang ||= 'zh-CN';
    for (const image of Array.from(doc.images)) this.markStandaloneMediaContainer(image);
    for (const svg of Array.from(doc.querySelectorAll('svg'))) this.markStandaloneMediaContainer(svg);
    this.applyReaderStyles(doc);
  }

  private getReaderColors() {
    return this.readerSettings.appearance === 'dark'
      ? { background: '#151517', text: '#f2f2f7', secondary: '#aeaeb2', link: '#64d2ff' }
      : { background: '#f3f2f8', text: '#1c1c1e', secondary: '#6e6e73', link: '#007aff' };
  }

  private applyReaderAppearanceToHost() {
    const { background } = this.getReaderColors();
    this.host.style.backgroundColor = background;
    if (this.view) this.view.style.backgroundColor = background;
  }

  private applyReaderStyles(doc: Document) {
    const colors = this.getReaderColors();
    const darkColorNormalize = this.readerSettings.appearance === 'dark' ? `
      /* Some EPUBs hard-code black text and white wrapper surfaces. In dark
         mode, normalize only common semantic text containers and their inline
         emphasis descendants. Images and SVG artwork remain untouched. */
      body :is(p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6) {
        color: inherit !important;
      }
      body :is(p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6)
        :is(span, strong, b, em, i, u, s, small, sup, sub) {
        color: inherit !important;
      }
      body :is(figcaption, caption) { color: ${colors.secondary} !important; }
      body > :is(main, article, section) { background-color: transparent !important; }
    ` : '';
    const existing = doc.querySelector<HTMLStyleElement>('style[data-reader-normalize="true"]');
    const style = existing ?? doc.createElement('style');
    style.dataset.readerNormalize = 'true';
    style.textContent = `
      html, body {
        max-width: 100% !important;
        overflow-x: hidden !important;
        background-color: ${colors.background} !important;
        color-scheme: ${this.readerSettings.appearance};
      }
      /* Reader Core owns the default type scale instead of inheriting every
         EPUB's legacy font CSS. On iOS, -apple-system resolves Chinese glyphs
         through PingFang SC. */
      body,
      body :is(p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6) {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", sans-serif !important;
      }
      body {
        color: ${colors.text} !important;
        font-size: ${this.readerSettings.fontSize}px !important;
        font-weight: 500 !important;
        line-height: ${this.readerSettings.lineHeight} !important;
        letter-spacing: ${this.readerSettings.letterSpacing}em !important;
      }
      body,
      body :is(p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, figcaption, caption),
      body :is(span, strong, b, em, i, u, s, small, sup, sub, a) {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
      body :is(button, input, select, textarea, [role="button"], [contenteditable="true"], [data-reader-ui]) {
        -webkit-user-select: none !important;
        user-select: none !important;
      }
      body :is(p, li, blockquote, dd, dt, td, th) {
        font-weight: 500 !important;
        line-height: ${this.readerSettings.lineHeight} !important;
      }
      body :is(h1, h2, h3, h4, h5, h6) {
        font-weight: 700 !important;
        line-height: 1.32 !important;
      }
      body :is(strong, b) { font-weight: 700 !important; }
      ${darkColorNormalize}
      body a { color: ${colors.link} !important; }
      /* A figure is semantic block content even when it includes a caption.
         Keep its artwork inside the reading column and center the complete
         visual group without changing inline image behavior. */
      figure {
        box-sizing: border-box !important;
        max-width: 100% !important;
        margin: 14px auto 20px !important;
        text-align: center !important;
        break-inside: avoid !important;
        -webkit-column-break-inside: avoid !important;
      }
      figure > img,
      figure > svg,
      figure > a > img,
      figure > a > svg,
      .reader-standalone-media > img,
      .reader-standalone-media > svg,
      .reader-standalone-media > a > img,
      .reader-standalone-media > a > svg {
        display: block !important;
        max-width: 100% !important;
        max-height: ${READER_STANDALONE_MEDIA_HEIGHT} !important;
        width: auto !important;
        height: auto !important;
        margin-left: auto !important;
        margin-right: auto !important;
        object-fit: contain !important;
        break-inside: avoid !important;
        -webkit-column-break-inside: avoid !important;
      }
      /* A paragraph/figure containing only one image is a visual page, not
         normal text flow. Match its height to the effective asymmetric Reader
         bounds so the artwork is centered and never sliced between columns. */
      .reader-standalone-media {
        box-sizing: border-box !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: ${READER_STANDALONE_MEDIA_HEIGHT} !important;
        min-height: ${READER_STANDALONE_MEDIA_HEIGHT} !important;
        margin: 0 !important;
        padding: 0 !important;
        break-inside: avoid !important;
        -webkit-column-break-inside: avoid !important;
      }
      .reader-standalone-media > img,
      .reader-standalone-media > svg,
      .reader-standalone-media > a > img,
      .reader-standalone-media > a > svg {
        max-height: 100% !important;
        max-width: 100% !important;
        margin: 0 auto !important;
      }
      table { max-width: 100% !important; }
    `;
    if (!existing) doc.head.append(style);
  }

  private markStandaloneMediaContainer(media: Element) {
    let container: HTMLElement | null = media.parentElement;
    // EPUBs commonly wrap covers or plate pages in links/spans/sections. Walk
    // through non-block wrappers, then classify the first visual block only.
    // Do not climb past a block that contains real reading text or a caption.
    while (container) {
      if (!['P', 'FIGURE', 'DIV', 'SECTION', 'BODY'].includes(container.tagName)) {
        container = container.parentElement;
        continue;
      }
      const meaningfulChildren = Array.from(container.childNodes).filter((node) => {
        if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
        if (!(node instanceof Element)) return false;
        if (node === media || node.contains(media)) return false;
        return true;
      });
      if (meaningfulChildren.length > 0) return;
      container.classList.add('reader-standalone-media');
      return;
    }
  }
}
