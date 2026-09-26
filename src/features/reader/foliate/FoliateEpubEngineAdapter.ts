import type {
  FootnoteAnchorRect,
  FootnotePayload,
  FootnoteRichTextNode,
  FootnoteSemanticType,
  ReaderBookmarkAnchor,
  ReaderBookmarkSnapshot,
  ReaderEngineDiagnostic,
  ReaderLocation,
  ReaderLocationChangeReason,
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
  // Section pre-warm support: foliate's own loader entry points. load()
  // warms the loader's blob-URL cache; unload() releases one refcount.
  load?: () => Promise<unknown>;
  unload?: () => void;
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
  getContents?: () => Array<{
    index: number;
    overlayer?: FoliateOverlayer | null;
    doc?: Document;
  }>;
};

/**
 * foliate-js Overlayer: per-section SVG paint layer. Entries are keyed by an
 * opaque string, so a transient reveal can share a section with permanent
 * highlights under its own key without disturbing them.
 */
type FoliateOverlayer = {
  add: (
    key: string,
    range: Range | ((doc: Document) => Range),
    draw: (rects: Array<{ left: number; top: number; width: number; height: number }>) => Element,
    options?: unknown,
  ) => void;
  remove: (key: string) => void;
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
const TAP_MAX_DURATION_MS = 350;
const TAP_MAX_MOVEMENT_PX = 10;
const SWIPE_MIN_DISTANCE_PX = 42;
const SWIPE_DIRECTION_DOMINANCE = 1.25;
// A fast flick commits the page turn even short of SWIPE_MIN_DISTANCE_PX.
// Velocity is px per ms, so 0.5 == 500 px/s. The minimum distance guards
// against committing on tap jitter.
const SWIPE_FLICK_MIN_DISTANCE_PX = 20;
const SWIPE_FLICK_VELOCITY_PX_PER_MS = 0.5;
const SELECTION_SETTLE_MS = 80;
const PAGE_COUNT_BATCH_SIZE = 12;
// Idle delay before warming the adjacent sections' loader cache. Only fires
// when the reader has been idle this long, so rapid page-turning never pays
// for pre-warm work it would outrun anyway.
const SECTION_PREWARM_IDLE_MS = 1500;
export const READER_VERTICAL_MARGIN_PX = 80;
export const READER_CONTENT_OFFSET_Y_PX = 32;
export const READER_CONTENT_HEIGHT_REDUCTION_PX = 32;
export const READER_PAGE_DISSOLVE_MS = 240;
export const READER_PAGE_DISSOLVE_DELAY_MS = 0;
const READER_CONTENT_TOP_PX = READER_VERTICAL_MARGIN_PX + READER_CONTENT_OFFSET_Y_PX;
const READER_CONTENT_BOTTOM_PX = READER_VERTICAL_MARGIN_PX;
const READER_VERTICAL_MARGIN = `${READER_VERTICAL_MARGIN_PX}px`;
const READER_STANDALONE_MEDIA_HEIGHT = `calc(100vh - ${READER_CONTENT_TOP_PX + READER_CONTENT_BOTTOM_PX}px)`;

/**
 * ReadingSession Core A: forward-text measurement helpers. The adapter owns
 * all EPUB DOM / CFI work so the screen layer never touches section
 * documents. Per AGENTS.md, section docs live in a different window: never
 * use cross-window `instanceof` on their nodes (always false); `nodeType`
 * checks are used instead.
 */
export type ForwardTextMeasurement =
  | {
      ok: true;
      direction: 'forward' | 'backward' | 'same';
      characters: number;
      fromSectionIndex: number;
      toSectionIndex: number;
    }
  | { ok: false; error: string };

type DocPoint = { node: Node; offset: number };

function anchorToDocPoint(anchor: unknown, doc: Document): DocPoint | null {
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

/** Readable text inside a range: boundary-clipped, script/style-free. */
function rangeReadableText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll('script, style, noscript').forEach((element) => element.remove());
  return fragment.textContent ?? '';
}

/**
 * Count readable characters: Unicode grapheme clusters (Intl.Segmenter with
 * a surrogate-pair-aware code-point fallback), whitespace excluded, CJK /
 * letters / digits / punctuation kept. No new dependencies.
 */
function countReadableCharacters(text: string): number {
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

type PendingPageTurn = {
  direction: 'next' | 'prev';
};

// ── Footnote popover ──────────────────────────────────────────────
// Semantic-first footnote support: explicit EPUB footnote semantics are
// intercepted first; conservative heuristics then cover real-world
// non-semantic patterns (v2: same-document plain links; v3: Kindle-style
// cross-document endnotes, Duokan embedded-text markers, Calibre dl/dd,
// vendor class names). Non-footnote links keep default behavior; rejected
// taps always fall back to the EPUB's natural navigation, never swallowed.

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
  /** Duokan/Zhangyue-style note text embedded in the marker itself. */
  embeddedText: string | null;
};

const FOOTNOTE_BACKLINK_ARROWS = new Set(['↩', '↪', '↑', '↓', '⏎', '←', '→', '^', '«', '»', '◎']);
/** Selector for explicit backlink markup (German publishers use `referrer`). */
const FOOTNOTE_BACKLINK_SELECTOR = '[epub\\:type="backlink"], [epub\\:type="referrer"], [role="doc-backlink"]';
/** Anchor classes marking a footnote reference (Pandoc/Calibre/Duokan/EPUB2-era). */
const FOOTNOTE_MARKER_CLASSES = new Set(['footnote-ref', 'noteref', 'duokan-footnote', 'endnotelink']);
/** Backlink classes (Pandoc `footnote-back`, EPUB2 `EndNoteBackLink`, Duokan `fnsymbol`, …). */
const FOOTNOTE_BACKLINK_CLASS_RE = /footnote-back|endnotebacklink|fnsymbol|simpara/i;
/** Image attributes carrying Duokan/Zhangyue-style embedded note text. */
const FOOTNOTE_IMG_TEXT_ATTRS = ['zy-footnote', 'data-footnote', 'data-footnote-text', 'data-note-text'];
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

// ── Heuristic footnote detection (exclusion-based) ────────────────────
// Semantic-first stays the primary path. For fragment links with NO
// explicit footnote semantics, the heuristic now defaults to ACCEPT: any
// marker-like inline link (`[1]`, `1`, `注1`, `*`, `〔1〕` …) in body text whose
// target carries substantive text pops over, unless an exclusion fires
// (backlink label, inside a notes area / TOC / nav / heading, or a
// heading-like target). EPUB producers invent a new footnote markup
// variant per book; an allowlist of "footnote signals" can never keep up,
// while the exclusions cover the shapes that are genuinely not footnotes.
// A tap is still never swallowed: targets with no extractable content
// fall back to default navigation in the click handler.

/** Marker-like labels: digits, [1], (1), 〔1〕, 注1/註1, superscript ¹²³, *, †, ‡. */
const FOOTNOTE_HEURISTIC_MARKER_RE = /^(?:[0-9¹²³⁴⁵⁶⁷⁸⁹⁰\s.[\]()\-–—*†‡〔〕【】〈〉《》]+|[注註][0-9¹²³⁴⁵⁶⁷⁸⁹⁰]+)$/;
/** Section headings that suggest a notes area: 注/释/footnote/endnote. */
const FOOTNOTE_NOTES_HEADING_RE = /注|释|footnote|endnote/i;
/** id/class hints: footnote, endnote, fn1, note-2, ntb, references … */
const FOOTNOTE_ID_CLASS_HINT_RE = /footnote|endnote|ntb|references|^(fn|note)[-_ ]?\d*$/i;
/** Minimum substantive text for a heuristic target (avoids empty anchors). */
const FOOTNOTE_HEURISTIC_MIN_TEXT = 4;
/** Tags that disqualify a heuristic target (TOC-style jumps). */
const FOOTNOTE_HEURISTIC_BAD_TARGET_RE = /^(h1|h2|h3|h4|h5|h6|a|script|style)$/i;

/**
 * True for backlink-ish labels: a bare arrow/dingbat ("↩", "◎"), or the
 * glyph with a trailing number ("←1", "◎2"). Variation selectors are
 * stripped first ("↩︎" → "↩"). Deliberately excludes "*": it doubles as a
 * footnote marker in real books.
 */
function isBacklinkLabel(rawLabel: string): boolean {
  const label = rawLabel.replace(/[\uFE0E\uFE0F]/g, '').trim();
  if (label === '') return false;
  if (FOOTNOTE_BACKLINK_ARROWS.has(label)) return true;
  const glyphs = label.replace(/[0-9\s.[\]()\-–—¹²³⁴⁵⁶⁷⁸⁹⁰]/g, '');
  return glyphs.length > 0
    && glyphs.length < label.length
    && [...glyphs].every((ch) => FOOTNOTE_BACKLINK_ARROWS.has(ch));
}

/** True when the anchor itself is a "back to text" link — never intercepted. */
function isBacklinkAnchor(anchor: HTMLAnchorElement): boolean {
  const epubType = anchor.getAttribute('epub:type');
  const role = anchor.getAttribute('role');
  if (epubType === 'backlink' || epubType === 'referrer' || role === 'doc-backlink') return true;
  if (FOOTNOTE_BACKLINK_CLASS_RE.test(anchor.getAttribute('class') ?? '')) return true;
  return isBacklinkLabel(anchor.textContent ?? '');
}

/** True when the anchor carries a known footnote-marker class. */
function hasFootnoteMarkerClass(anchor: HTMLAnchorElement): boolean {
  const tokens = (anchor.getAttribute('class') ?? '').toLowerCase().split(/\s+/);
  return tokens.some((token) => FOOTNOTE_MARKER_CLASSES.has(token));
}

/**
 * Duokan/Zhangyue-style embedded note text: the note lives in an image
 * attribute (`zy-footnote`, `data-footnote*`) inside the marker anchor,
 * with `alt` as fallback. Returns the text or null.
 */
function getEmbeddedFootnoteText(anchor: HTMLAnchorElement): string | null {
  const candidates: Element[] = [anchor, ...Array.from(anchor.querySelectorAll('img'))];
  for (const el of candidates) {
    for (const attr of FOOTNOTE_IMG_TEXT_ATTRS) {
      const value = el.getAttribute(attr)?.trim();
      if (value) return value;
    }
  }
  for (const img of Array.from(anchor.querySelectorAll('img'))) {
    const alt = img.getAttribute('alt')?.trim() ?? '';
    // Generic alts ("note", "icon") are not note text.
    if (alt.length >= 6) return alt;
  }
  return null;
}

/**
 * Real-world footnote targets are often marker anchors (`<a id="fn1">`, or
 * the backlink itself carrying the id) rather than the footnote body.
 * Promote text-less anchor targets to the enclosing block so extraction and
 * heuristics operate on the actual note content.
 */
function resolveFootnoteBody(target: Element): Element {
  const tag = target.tagName.toLowerCase();
  if (tag === 'dt') {
    // Calibre-style `<dl class="footnote"><dt>[←1]</dt><dd>…</dd></dl>`:
    // the definition list is the note body (dt labels are stripped later).
    const dl = target.closest('dl');
    if (dl) return dl;
  }
  if (tag !== 'a') return target;
  const label = (target.textContent ?? '').trim();
  // An anchor carrying real text is the content itself; a marker-like (or
  // empty) anchor is just a marker — delegate to the enclosing block.
  const isMarker = label === ''
    || label.length < FOOTNOTE_HEURISTIC_MIN_TEXT
    || FOOTNOTE_HEURISTIC_MARKER_RE.test(label);
  if (!isMarker) return target;
  const parent = target.closest('p,li,aside,div,section,blockquote,dd,dl');
  return parent && parent !== target ? parent : target;
}

/**
 * The id a footnote's backlink points to. Usually the marker's own id, but
 * some producers put it on an empty placeholder anchor immediately before
 * the marker link instead:
 * `<a id="w1"></a><a href="part0065.xhtml#m1"><sup>[1]</sup></a>`.
 * Used to strip the backlink from the extracted popover content.
 */
function resolveCitingAnchorId(anchor: HTMLAnchorElement): string | null {
  const ownId = anchor.getAttribute('id');
  if (ownId) return ownId;
  const prev = anchor.previousElementSibling;
  if (
    prev
    && prev.tagName.toLowerCase() === 'a'
    && !prev.hasAttribute('href')
    && (prev.textContent ?? '').trim() === ''
  ) {
    return prev.getAttribute('id');
  }
  return null;
}

/**
 * True when the element sits inside a footnote area: explicit footnote
 * semantics on self/ancestors, a footnote-hint id/class (e.g.
 * `<p class="note">`, `<li id="fn1">`), or a "notes" label block (e.g.
 * `<p><span>注 释</span></p>`, `<h2>Footnotes</h2>`) among preceding
 * siblings. Real-world books often use flat structures with no section
 * wrapper, so the sibling scan covers that. Used to keep backlink taps
 * (inside the notes) on default navigation.
 */
function isInFootnoteArea(element: Element): boolean {
  let el: Element | null = element;
  let isSelf = true;
  while (el && el.tagName.toLowerCase() !== 'body') {
    if (getFootnoteSemanticType(el)) return true;
    // The element's own marker class (e.g. `footnote-ref`) must not count:
    // only ancestors make it a footnote area.
    if (!isSelf && footnoteTargetIdClassHint(el)) return true;
    isSelf = false;
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
 * Exclusion for the default-accept heuristic: links inside a table of
 * contents or navigation landmark are navigational even when their label
 * looks marker-like (e.g. a numeric chapter link `<a href="#ch1">1</a>`).
 */
function isInTocOrNav(element: Element): boolean {
  return element.closest('nav, [role="doc-toc"], [epub\\:type="toc"]') != null;
}

/**
 * Exclusion for the default-accept heuristic: a link inside a heading
 * (e.g. inside a chapter title) navigates, it is not a footnote reference.
 */
function isInsideHeading(element: Element): boolean {
  return element.closest('h1,h2,h3,h4,h5,h6') != null;
}

/**
 * Combined id + class string for footnote-hint matching. Trimmed: the
 * anchored `^(fn|note)[-_ ]?\d*$` alternative needs exact boundaries, so an
 * untrimmed `" note"` / `"fn1 "` would never match it.
 */
function idClassHintString(el: Element): string {
  return `${el.getAttribute('id') ?? ''} ${(el as HTMLElement).className ?? ''}`.trim();
}

function footnoteTargetIdClassHint(target: Element): boolean {
  return FOOTNOTE_ID_CLASS_HINT_RE.test(idClassHintString(target));
}

/**
 * Heuristic: does this non-semantic same-document link look like a footnote
 * reference? Exclusion-based (default ACCEPT): a marker-like inline label
 * (`[1]`, `1`, `注1`, `*`, `〔1〕` …) pointing at a substantive non-heading target
 * pops over, unless the link is clearly navigational — a backlink, inside
 * the notes area / TOC / nav / a heading. New producer markup variants are
 * accepted without needing a dedicated signal first.
 */
function isHeuristicFootnoteReference(
  anchor: HTMLAnchorElement,
  target: Element,
): boolean {
  if (isBacklinkAnchor(anchor)) return false;
  // A tap inside the notes area is a backlink (or nested content), never a
  // new reference — leave it on default navigation.
  if (isInFootnoteArea(anchor)) return false;
  if (isInTocOrNav(anchor)) return false;
  if (isInsideHeading(anchor)) return false;
  const label = (anchor.textContent ?? '').trim();
  if (label === '' || label.length > 8 || !FOOTNOTE_HEURISTIC_MARKER_RE.test(label)) return false;
  if (FOOTNOTE_HEURISTIC_BAD_TARGET_RE.test(target.tagName)) return false;
  const text = (target.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < FOOTNOTE_HEURISTIC_MIN_TEXT) return false;
  return true;
}

/**
 * Sync gate for the cross-document heuristic (Kindle-style semantic-less
 * endnotes: `<sup><a href="footnotes.html#fn1">[2]</a></sup>`). Cheap
 * checks only — the target document is loaded and verified asynchronously
 * in openFootnotePopover, which falls back to default navigation on
 * rejection, so a tap is never swallowed.
 */
function isHeuristicCrossDocFootnoteReference(anchor: HTMLAnchorElement): boolean {
  if (isBacklinkAnchor(anchor)) return false;
  if (isInFootnoteArea(anchor)) return false;
  if (isInTocOrNav(anchor)) return false;
  if (isInsideHeading(anchor)) return false;
  const label = (anchor.textContent ?? '').trim();
  const labelOk = label !== '' && label.length <= 8 && FOOTNOTE_HEURISTIC_MARKER_RE.test(label);
  if (!labelOk && !getEmbeddedFootnoteText(anchor) && !hasFootnoteMarkerClass(anchor)) return false;
  return true;
}

/**
 * Target-side verification for the cross-document heuristic, run against
 * the loaded target document. Default ACCEPT (mirrors the same-document
 * exclusion-based heuristic): a substantive non-heading target outside the
 * target document's TOC/nav pops over.
 */
function isHeuristicCrossDocFootnoteTarget(target: Element, anchor: HTMLAnchorElement): boolean {
  if (FOOTNOTE_HEURISTIC_BAD_TARGET_RE.test(target.tagName)) return false;
  const text = (target.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < FOOTNOTE_HEURISTIC_MIN_TEXT) return false;
  if (isInTocOrNav(target)) return false;
  return true;
}

/**
 * Strip backlinks ("↩", epub:type="backlink", role="doc-backlink"): closing
 * the popover already returns the reader to the original position, so a
 * back-to-text link inside the popover is meaningless.
 * `citingAnchorId` catches mutual backlinks with no backlink markup: any
 * same-document link pointing back at the citing anchor's own id.
 */
function cleanFootnoteClone(clone: Element, citingAnchorId?: string | null): void {
  // Calibre-style definition lists: the <dt> cells are just labels
  // ("[←1]"); the <dd> cells carry the note text.
  if (clone.tagName.toLowerCase() === 'dl') {
    for (const dt of Array.from(clone.querySelectorAll(':scope > dt'))) dt.remove();
  }
  const stripBacklinks = () => {
    for (const backlink of Array.from(clone.querySelectorAll(FOOTNOTE_BACKLINK_SELECTOR))) {
      backlink.remove();
    }
    for (const anchor of Array.from(clone.querySelectorAll('a'))) {
      const href = anchor.getAttribute('href') ?? '';
      const label = (anchor.textContent ?? '').trim();
      const anchorEpubType = anchor.getAttribute('epub:type');
      if (anchorEpubType === 'backlink' || anchorEpubType === 'referrer' || anchor.getAttribute('role') === 'doc-backlink') {
        anchor.remove();
      } else if (href.startsWith('#') && isBacklinkLabel(label)) {
        anchor.remove();
      } else if (citingAnchorId) {
        const hashIndex = href.indexOf('#');
        if (hashIndex >= 0 && decodeFootnoteFragment(href.slice(hashIndex + 1)) === citingAnchorId) {
          anchor.remove();
        }
      }
    }
  };
  stripBacklinks();
  stripBacklinks();
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

// Phase 1 highlight color: single default blue. The color column already
// exists in the DB so a future multi-color phase needs no migration.
const HIGHLIGHT_FILL = '#0A84FF';
const HIGHLIGHT_OPACITY = '0.28';

// Excerpts Tab Core C: transient reveal emphasis for an excerpt jump target.
// Deliberately distinct from the permanent highlight blue: a light system-
// yellow wash at low opacity, drawn under its own overlayer key so the
// permanent highlight paint underneath is never touched.
const REVEAL_FILL = '#FFD60A';
const REVEAL_OPACITY = '0.25';
export const EXCERPT_REVEAL_DURATION_MS = 1500;

function drawRevealRects(rects: Array<{ left: number; top: number; width: number; height: number }>) {
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

function drawHighlightRects(rects: Array<{ left: number; top: number; width: number; height: number }>) {
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

/** The only formal Reader Core wrapper around foliate-js. */
export class FoliateEpubEngineAdapter {
  private view: FoliateView | null = null;
  // Every loaded spine document gets exactly one owner and one stable index.
  // A Map also lets destroy remove listeners from every still-live document.
  private loadedDocuments = new Map<Document, number>();
  private gestureCleanups = new Map<Document, () => void>();
  private selectionCleanups = new Map<Document, () => void>();
  private footnoteCleanups = new Map<Document, () => void>();
  // Highlight paint registry: range CFI -> owning spine section. foliate's
  // View keeps no persistent annotation list, so the adapter re-applies these
  // whenever a section document (re)loads (settings change, chapter turn).
  private highlightRegistry = new Map<string, { sectionIndex: number }>();
  // Live Range cache per loaded document, captured from the draw-annotation
  // event. Used for synchronous tap hit-testing; cleared on doc release.
  private highlightRanges = new Map<Document, Array<{ rangeCfi: string; range: Range }>>();
  private highlightBubble: { doc: Document; element: HTMLElement } | null = null;
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
  // Adjacent-section pre-warm: indexes whose loader cache entry we warmed and
  // still owe exactly one unload() to. Paired on arrival or when stale.
  private prewarmedSectionIndexes = new Set<number>();
  private sectionPrewarmTimer: number | null = null;
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
  /**
   * ReadingSession Core A: explicit source of the in-flight navigation.
   * Set by the call site before view.next()/prev()/goTo(), attached to every
   * relocate that fires while set, and cleared in the call-site finally.
   * Relocates outside an explicit navigation get no reason ('unknown') and
   * are treated conservatively as a segment rebase by the session tracker.
   */
  private pendingNavigationReason: ReaderLocationChangeReason | null = null;
  /**
   * Excerpts Tab Core C: transient reveal bookkeeping. The generation makes
   * each reveal's paint key unique so concurrent reveals never clear each
   * other's paint; the entry set lets destroy() settle any in-flight reveal
   * instead of leaving its promise dangling. The reveal never touches the
   * highlight registry.
   */
  private revealGeneration = 0;
  // In-flight transient reveals. Each entry carries its own resolve so
  // destroy() can settle the waiters instead of leaving their promises
  // dangling after clearTimeout.
  private revealTimers = new Set<{ timer: ReturnType<typeof setTimeout>; resolve: () => void }>();
  /** Serializes measureForwardText so bursts settle in occurrence order. */
  private textMeasureQueue: Promise<void> = Promise.resolve();
  /** Lightweight per-section plain-text cache for forward measurement. */
  private sectionTextCache = new Map<number, Promise<string | null>>();

  constructor(
    private readonly host: HTMLElement,
    private readonly onLocation: (location: ReaderLocation, restoreState: ReaderRestoreState) => void,
    private readonly onCenterTap: () => void,
    private readonly onDiagnostic: (diagnostic: ReaderEngineDiagnostic) => void,
    private readonly onPageCount: (result: ReaderPageCountResult) => void,
    private readonly onToc: (toc: ReaderTocItem[]) => void,
    private readonly onSelectionChange: (selection: ReaderSelectionPayload | null) => void,
    private readonly onFootnoteOpen: (payload: FootnotePayload) => void,
    // Synchronous "a footnote popover is on screen" signal from the host.
    // Read on every pointer-up so taps are classified modally while open.
    private readonly isFootnotePopoverOpen: () => boolean,
    // A highlight was deleted from its in-doc bubble. The adapter already
    // removed the paint; the host persists the deletion to SQLite.
    private readonly onHighlightDeleteRequest: (rangeCfi: string) => void,
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
    // Excerpts Tab Core C: an external navigation target (tapping an excerpt
    // Source row) becomes the *initial* navigation intent, not a second
    // goTo() after restore. The target is pre-checked while the view is still
    // hidden; a target whose anchor throws against the live section document
    // (e.g. a stale CFI from an older book version) is caught and the same
    // view re-inits at the saved progress instead. That retry is safe: the
    // paginator already holds a fully loaded section view at that point
    // (#display attaches it before the anchor runs), so the second init just
    // navigates elsewhere. Either way the reader never fails to open here,
    // and EXTERNAL_TARGET_RESULT tells native whether the notice is needed.
    const progressCfi = input.restoreCfi?.startsWith('epubcfi(') ? input.restoreCfi : null;
    const rawExternalCfi = input.externalTargetCfi ?? null;
    const externalCfi = rawExternalCfi?.startsWith('epubcfi(') ? rawExternalCfi : null;
    // offered 按"有没有给"算，不按"给的对不对"算：畸形的 target 也要走
    // EXTERNAL_TARGET_RESULT → Reader 回退到 saved progress 并提示，
    // 而不是在这里被静默忽略。
    const externalOffered = rawExternalCfi !== null;
    let externalResolved = false;
    let targetCfi = progressCfi;
    this.onDiagnostic({ event: 'VIEW_INIT_START' });
    this.onDiagnostic({ event: 'PAGINATION_START' });
    // The initial restore is an explicit non-reading relocation for the
    // session tracker: it establishes the segment baseline, not progress.
    // An external target is an annotation-style jump (rebase, not reading).
    this.pendingNavigationReason = 'restore';
    if (externalCfi !== null && this.isRangeCfiResolvable(externalCfi)) {
      if (__DEV__) {
        console.log('[READER_EXTERNAL_NAV]', JSON.stringify({
          bookId: input.bookId,
          reason: 'annotation',
          cfiLength: externalCfi.length,
        }));
      }
      this.onDiagnostic({ event: 'RESTORE_REQUEST', targetCfi: externalCfi });
      this.pendingNavigationReason = 'annotation';
      try {
        await view.init({ lastLocation: externalCfi, showTextStart: true });
        externalResolved = true;
        targetCfi = externalCfi;
      } catch {
        // The anchor failed against the live section document. Fall through
        // to the saved progress below.
        this.pendingNavigationReason = 'restore';
        if (__DEV__) console.warn('[READER_RANGE_NAV_FAILED]', JSON.stringify({ reason: 'init-anchor-failed' }));
      }
    }
    if (!externalResolved) {
      this.onDiagnostic({ event: 'RESTORE_REQUEST', targetCfi });
      try {
        await view.init({ lastLocation: targetCfi, showTextStart: true });
      } finally {
        this.pendingNavigationReason = null;
      }
    } else {
      this.pendingNavigationReason = null;
    }
    if (externalOffered) {
      this.onDiagnostic({ event: 'EXTERNAL_TARGET_RESULT', resolved: externalResolved });
      if (!externalResolved && __DEV__) {
        console.log('[READER_RANGE_NAV_FAILED]', JSON.stringify({ reason: 'unresolvable-target' }));
      }
    }
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
    if (externalResolved && externalCfi) {
      // The transient reveal is engine-owned: it paints on the live section
      // overlayer under a unique key, so a permanent highlight on the same
      // range is never disturbed. Fire-and-forget: open() must not wait out
      // the reveal duration before resolving.
      void this.revealRange(externalCfi, EXCERPT_REVEAL_DURATION_MS).catch((error) => {
        if (__DEV__) console.warn('[READER_RANGE_REVEAL]', 'reveal failed', error);
      });
    }
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

  async goTo(location: string, reason: ReaderLocationChangeReason = 'programmatic') {
    const view = this.view;
    if (!view) throw new Error('Reader 尚未就绪。');
    const resolved = view.resolveNavigation?.(location) ?? view.book?.resolveHref?.(location);
    if (!resolved || typeof resolved.index !== 'number' || resolved.index < 0) {
      throw new Error(`Reader 目标无效：${location}`);
    }
    this.clearActiveSelection(true);
    await this.clearSelectedSearchHighlight();
    this.reflowing = true;
    // The relocation(s) emitted by view.goTo() carry this explicit reason;
    // the tracker never guesses from CFI distance.
    this.pendingNavigationReason = reason;
    try {
      await view.goTo(location);
      await this.nextFrame();
      const current = this.getLocation();
      if (current.spineIndex !== resolved.index) throw new Error(`Reader 目标未能定位：${location}`);
      return current;
    } finally {
      this.pendingNavigationReason = null;
      this.reflowing = false;
    }
  }

  async goToSearchResult(cfi: string, reason: ReaderLocationChangeReason = 'search') {
    const location = await this.goTo(cfi, reason);
    const view = this.view;
    if (!view?.addAnnotation) return location;
    this.selectedSearchHighlightCfi = cfi;
    await view.addAnnotation({ kind: 'reader-search-result', value: cfi });
    return location;
  }

  /**
   * ReadingSession Core A: count the readable characters between two CFIs.
   *
   * The ReaderScreen never parses EPUB DOM or compares CFIs; all measurement
   * lives here next to foliate. Rules:
   * - only confirmed forward movement counts (caller decides what "forward"
   *   means via navigation reasons; this method just measures the span);
   * - Unicode grapheme clusters via Intl.Segmenter with a code-point
   *   fallback; whitespace is excluded, CJK/letters/digits/punctuation kept;
   * - cross-section spans count the tail of the start section, full middle
   *   sections in spine order, and the head of the end section;
   * - failures resolve { ok: false } — never throw into the tracker queue,
   *   never print book text, never guess from progress or page counts.
   * Serialized so rapid A→B→C bursts settle in occurrence order.
   */
  async measureForwardText(fromCfi: string, toCfi: string): Promise<ForwardTextMeasurement> {
    const run = async (): Promise<ForwardTextMeasurement> => {
      try {
        return await this.measureForwardTextInternal(fromCfi, toCfi);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    };
    const queued = this.textMeasureQueue.then(run);
    this.textMeasureQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async measureForwardTextInternal(fromCfi: string, toCfi: string): Promise<ForwardTextMeasurement> {
    const view = this.view;
    const sections = view?.book?.sections;
    if (!view?.resolveNavigation || !sections || sections.length === 0) {
      throw new Error('engine not ready');
    }
    const fromResolved = view.resolveNavigation(fromCfi);
    const toResolved = view.resolveNavigation(toCfi);
    const fromIndex = fromResolved?.index;
    const toIndex = toResolved?.index;
    if (typeof fromIndex !== 'number' || typeof toIndex !== 'number' || fromIndex < 0 || toIndex < 0) {
      throw new Error('unresolvable cfi');
    }
    if (fromIndex > toIndex) {
      return { ok: true, direction: 'backward', characters: 0, fromSectionIndex: fromIndex, toSectionIndex: toIndex };
    }
    if (fromIndex === toIndex) {
      const doc = await sections[fromIndex].createDocument?.();
      if (!doc) throw new Error('section document unavailable');
      const fromPoint = anchorToDocPoint(fromResolved?.anchor?.(doc), doc);
      const toPoint = anchorToDocPoint(toResolved?.anchor?.(doc), doc);
      if (!fromPoint || !toPoint) throw new Error('anchor unresolvable');
      const span = doc.createRange();
      span.setStart(fromPoint.node, fromPoint.offset);
      span.setEnd(toPoint.node, toPoint.offset);
      if (span.collapsed) {
        return { ok: true, direction: 'same', characters: 0, fromSectionIndex: fromIndex, toSectionIndex: toIndex };
      }
      return {
        ok: true,
        direction: 'forward',
        characters: countReadableCharacters(rangeReadableText(span)),
        fromSectionIndex: fromIndex,
        toSectionIndex: toIndex,
      };
    }
    // Cross-section: tail of the start section, full middle sections in
    // spine order, head of the end section.
    const fromDoc = await sections[fromIndex].createDocument?.();
    const toDoc = await sections[toIndex].createDocument?.();
    if (!fromDoc || !toDoc) throw new Error('section document unavailable');
    const fromPoint = anchorToDocPoint(fromResolved?.anchor?.(fromDoc), fromDoc);
    const toPoint = anchorToDocPoint(toResolved?.anchor?.(toDoc), toDoc);
    if (!fromPoint || !toPoint) throw new Error('anchor unresolvable');
    const fromBody = fromDoc.body ?? fromDoc.documentElement;
    const tail = fromDoc.createRange();
    tail.setStart(fromPoint.node, fromPoint.offset);
    tail.setEnd(fromBody, fromBody.childNodes.length);
    const toBody = toDoc.body ?? toDoc.documentElement;
    const head = toDoc.createRange();
    head.setStart(toBody, 0);
    head.setEnd(toPoint.node, toPoint.offset);
    let characters = countReadableCharacters(rangeReadableText(tail))
      + countReadableCharacters(rangeReadableText(head));
    for (let index = fromIndex + 1; index < toIndex; index += 1) {
      const middleText = await this.getSectionPlainText(index);
      if (middleText !== null) characters += countReadableCharacters(middleText);
    }
    return { ok: true, direction: 'forward', characters, fromSectionIndex: fromIndex, toSectionIndex: toIndex };
  }

  /**
   * Full plain text of one section for cross-section measurement.
   * Cached per adapter lifetime; documents are created offscreen and
   * released after extraction.
   */
  private getSectionPlainText(sectionIndex: number): Promise<string | null> {
    const cached = this.sectionTextCache.get(sectionIndex);
    if (cached) return cached;
    const task = (async (): Promise<string | null> => {
      try {
        const section = this.view?.book?.sections?.[sectionIndex];
        const doc = await section?.createDocument?.();
        if (!doc) return null;
        const body = doc.body ?? doc.documentElement;
        const clone = body.cloneNode(true) as Element;
        clone.querySelectorAll('script, style, noscript').forEach((element) => element.remove());
        return clone.textContent ?? '';
      } catch {
        return null;
      }
    })();
    this.sectionTextCache.set(sectionIndex, task);
    return task;
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

  /**
   * Excerpts Tab Core C: true when foliate can synchronously resolve a range
   * CFI to a section anchor. Never throws; foliate's own resolveNavigation
   * already swallows resolution errors and returns undefined.
   */
  private isRangeCfiResolvable(rangeCfi: string): boolean {
    try {
      const resolved = this.view?.resolveNavigation?.(rangeCfi);
      return typeof resolved?.index === 'number'
        && resolved.index >= 0
        && typeof resolved.anchor === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Excerpts Tab Core C: transient emphasis for an excerpt jump target.
   *
   * Paints directly on the *live* section overlayer under a unique
   * `reader-reveal:<generation>` key — never through foliate's
   * addAnnotation, which keys by CFI value and would first erase a permanent
   * highlight painted on the same range. The reveal Range is intentionally
   * NOT cached in highlightRanges, so tapping it never opens the highlight
   * menu. Removes only its own key after `durationMs`; writes nothing to the
   * database. Throws when the target cannot be resolved or the section has
   * no live overlayer.
   */
  async revealRange(rangeCfi: string, durationMs = EXCERPT_REVEAL_DURATION_MS): Promise<void> {
    const view = this.view;
    if (!view) throw new Error('无法定位到原摘录位置。');
    const resolved = view.resolveNavigation?.(rangeCfi);
    const sectionIndex = resolved?.index;
    if (typeof sectionIndex !== 'number' || sectionIndex < 0 || typeof resolved?.anchor !== 'function') {
      throw new Error('无法定位到原摘录位置。');
    }
    const content = view.renderer?.getContents?.().find((item) => item.index === sectionIndex);
    const overlayer = content?.overlayer;
    const doc = content?.doc;
    if (!overlayer || !doc) throw new Error('无法定位到原摘录位置。');
    const anchorResult = resolved.anchor(doc);
    if (!this.isRangeLike(anchorResult)) throw new Error('无法定位到原摘录位置。');
    const generation = ++this.revealGeneration;
    const key = `reader-reveal:${generation}`;
    overlayer.add(key, anchorResult, drawRevealRects);
    if (__DEV__) {
      console.log('[READER_RANGE_REVEAL]', JSON.stringify({
        success: true,
        durationMs,
        cfiLength: rangeCfi.length,
      }));
    }
    await new Promise<void>((resolve) => {
      const entry = { resolve } as { timer: ReturnType<typeof setTimeout>; resolve: () => void };
      entry.timer = setTimeout(() => {
        this.revealTimers.delete(entry);
        resolve();
      }, durationMs);
      this.revealTimers.add(entry);
    });
    // 每个 reveal 只删自己 generation 唯一的 key，新旧 reveal 互不干扰，
    // 不需要 generation 守卫；守卫反而会让被取代的旧 key 的 paint 永远残留在 overlayer 上。
    try {
      overlayer.remove(key);
    } catch (error) {
      if (__DEV__) console.warn('[READER_REVEAL_CLEAR_FAILED]', error);
    }
  }

  /**
   * Excerpts Tab Core C (warm path): the book is already open and visible,
   * so navigate to the excerpt target as an annotation-style jump. Throws
   * when the target cannot be resolved; the reader stays where it is.
   */
  async goToExcerptTarget(rangeCfi: string): Promise<void> {
    if (!this.isRangeCfiResolvable(rangeCfi)) {
      if (__DEV__) console.log('[READER_RANGE_NAV_FAILED]', JSON.stringify({ reason: 'unresolvable-target' }));
      throw new Error('无法定位到原摘录位置。');
    }
    await this.goTo(rangeCfi, 'annotation');
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

  // Highlight paint (Annotation Core phase 1). Paint goes through foliate's
  // overlayer (SVG rects, pointer-events:none) so the book DOM is never
  // mutated and CFI stability is unaffected. The registry is the source of
  // truth for re-painting after section (re)loads.
  async setHighlights(items: Array<{ rangeCfi: string; sectionIndex: number }>) {
    this.highlightRegistry = new Map(
      items.filter((item) => item.rangeCfi.startsWith('epubcfi('))
        .map((item) => [item.rangeCfi, { sectionIndex: item.sectionIndex }]),
    );
    // Re-paint into whatever section is currently loaded; foliate silently
    // skips annotations whose section has no live overlayer.
    const view = this.view;
    if (!view?.addAnnotation) return;
    for (const rangeCfi of this.highlightRegistry.keys()) {
      try {
        await view.addAnnotation({ kind: 'reader-highlight', value: rangeCfi });
      } catch (error) {
        if (__DEV__) console.warn('[HIGHLIGHT_PAINT_FAILED]', rangeCfi, error);
      }
    }
  }

  async addAnnotation(rangeCfi: string, sectionIndex: number) {
    if (!rangeCfi.startsWith('epubcfi(')) return;
    this.highlightRegistry.set(rangeCfi, { sectionIndex });
    const view = this.view;
    if (!view?.addAnnotation) return;
    try {
      await view.addAnnotation({ kind: 'reader-highlight', value: rangeCfi });
    } catch (error) {
      if (__DEV__) console.warn('[HIGHLIGHT_PAINT_FAILED]', rangeCfi, error);
    }
  }

  async removeAnnotation(rangeCfi: string) {
    this.highlightRegistry.delete(rangeCfi);
    for (const [doc, items] of this.highlightRanges) {
      const next = items.filter((item) => item.rangeCfi !== rangeCfi);
      if (next.length !== items.length) this.highlightRanges.set(doc, next);
    }
    this.dismissHighlightBubble();
    const view = this.view;
    if (!view?.deleteAnnotation) return;
    try {
      await view.deleteAnnotation({ kind: 'reader-highlight', value: rangeCfi });
    } catch (error) {
      if (__DEV__) console.warn('[HIGHLIGHT_REMOVE_FAILED]', rangeCfi, error);
    }
  }

  private async applyHighlightsForSection(index: number) {
    const view = this.view;
    if (!view?.addAnnotation || index < 0) return;
    for (const [rangeCfi, entry] of this.highlightRegistry) {
      if (entry.sectionIndex !== index) continue;
      try {
        await view.addAnnotation({ kind: 'reader-highlight', value: rangeCfi });
      } catch (error) {
        if (__DEV__) console.warn('[HIGHLIGHT_PAINT_FAILED]', rangeCfi, error);
      }
    }
  }

  // Synchronous tap hit-test against the cached live Ranges. Both the tap's
  // clientX/Y and getClientRects() live in the section iframe's viewport
  // coordinate space, so they compare directly (no screenX mapping needed).
  private hitTestHighlight(doc: Document, clientX: number, clientY: number): string | null {
    const items = this.highlightRanges.get(doc);
    if (!items || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    for (const { rangeCfi, range } of items) {
      let rects: DOMRectList | null = null;
      try {
        rects = range.getClientRects();
      } catch {
        continue;
      }
      for (const rect of Array.from(rects)) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          return rangeCfi;
        }
      }
    }
    return null;
  }

  private showHighlightDeleteBubble(doc: Document, rangeCfi: string, clientX: number, clientY: number) {
    this.dismissHighlightBubble();
    const bubble = doc.createElement('div');
    bubble.setAttribute('data-reader-ui', 'true');
    bubble.setAttribute('data-reader-highlight-bubble', 'true');
    // position:fixed shares the tap's iframe-viewport coordinate space.
    bubble.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      `left:${Math.round(clientX)}px`,
      `top:${Math.round(clientY)}px`,
      'transform:translate(-50%,-135%)',
      'pointer-events:auto',
    ].join(';');
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = '删除';
    button.style.cssText = [
      'appearance:none',
      'border:none',
      'border-radius:11px',
      'background:rgba(28,28,30,0.94)',
      'color:#fff',
      'font-size:15px',
      'font-family:-apple-system,system-ui,sans-serif',
      'padding:9px 20px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
      'cursor:pointer',
    ].join(';');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      void this.removeAnnotation(rangeCfi).then(() => {
        try {
          this.onHighlightDeleteRequest(rangeCfi);
        } catch (error) {
          if (__DEV__) console.warn('[HIGHLIGHT_DELETE_REQUEST_FAILED]', error);
        }
      });
    });
    bubble.append(button);
    // data-reader-ui keeps this out of text selection (readSelection filter).
    doc.body?.append(bubble);
    this.highlightBubble = { doc, element: bubble };
  }

  private dismissHighlightBubble() {
    const bubble = this.highlightBubble;
    this.highlightBubble = null;
    try {
      bubble?.element.remove();
    } catch {
      // Already detached with its document.
    }
  }

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
    this.dismissHighlightBubble();
    // Excerpts Tab Core C: cancel any in-flight transient reveal; its
    // overlayer is being torn down with the view, and a newer open gets a
    // fresh generation. Settle the waiters so their promises never dangle;
    // the post-await paint cleanup removes only their own key and is
    // try/caught against the torn-down overlayer.
    for (const entry of this.revealTimers) {
      clearTimeout(entry.timer);
      entry.resolve();
    }
    this.revealTimers.clear();
    this.revealGeneration += 1;
    this.highlightRanges.clear();
    this.highlightRegistry.clear();
    // ReadingSession measurement state is per-book: never let one book's
    // section text leak into the next book's forward-character counts.
    this.sectionTextCache.clear();
    this.textMeasureQueue = Promise.resolve();
    this.pendingNavigationReason = null;
    // Release any warmed section cache entries while the view (and its book)
    // is still reachable; each warmed section owes exactly one unload().
    this.clearAllSectionPrewarms();
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
    annotation?: { kind?: string; value?: string };
    doc?: Document;
    range?: Range;
    draw?: (drawer: typeof drawSearchResultHighlight, options?: object) => void;
  }>) => {
    const kind = event.detail?.annotation?.kind;
    if (kind === 'reader-search-result') {
      event.detail.draw?.(drawSearchResultHighlight);
      return;
    }
    if (kind !== 'reader-highlight') return;
    event.detail.draw?.(drawHighlightRects);
    // Cache the live Range for synchronous tap hit-testing. foliate's
    // overlayer keeps its own copy for redraws; this cache is only read.
    const doc = event.detail?.doc;
    const range = event.detail?.range;
    const value = event.detail?.annotation?.value;
    if (!doc || !range || !value) return;
    const items = this.highlightRanges.get(doc) ?? [];
    if (!items.some((item) => item.rangeCfi === value)) {
      items.push({ rangeCfi: value, range });
      this.highlightRanges.set(doc, items);
    }
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
      // Attach the explicit navigation reason (if any) stamped by the call
      // site. Without one this relocate is 'unknown': the session tracker
      // treats it as a segment rebase, never as reading progress.
      location.navigationReason = this.pendingNavigationReason ?? 'unknown';
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
      this.highlightRanges.delete(loadedDoc);
      if (this.highlightBubble?.doc === loadedDoc) this.highlightBubble = null;
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
    // foliate attaches the section overlayer AFTER the load event
    // (create-overlayer), so defer highlight paint by a frame; a same-frame
    // chapter turn makes this a harmless no-op via the section filter.
    requestAnimationFrame(() => { void this.applyHighlightsForSection(index); });
    // The section changed (cross-section turn, TOC jump, or initial open):
    // reconcile adjacent-section pre-warm around the new index. Same-section
    // page turns don't change the adjacent set, so they need no work here.
    if (index >= 0) this.reconcileSectionPrewarms(index);
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
    let anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) {
      // Href-less footnote markers (Duokan/Zhangyue image markers): only
      // intercept when the anchor carries a footnote-marker class or
      // embedded note text — bare named anchors keep default (no-op).
      const bareAnchor = target?.closest?.('a') as HTMLAnchorElement | null;
      if (bareAnchor && (hasFootnoteMarkerClass(bareAnchor) || getEmbeddedFootnoteText(bareAnchor))) {
        anchor = bareAnchor;
      }
    }
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
    if (!ref.crossDocument && ref.targetElement && !ref.embeddedText) {
      // Never swallow a tap: if the footnote has no extractable content,
      // let the EPUB's default anchor navigation proceed untouched.
      // (With embedded marker text there is always something to show.)
      if (!extractFootnoteContent(ref.targetElement, anchorLabel, resolveCitingAnchorId(anchor)).text) {
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
    const book = this.view?.book;
    const sectionIndex = this.loadedDocuments.get(doc) ?? -1;
    const section = sectionIndex >= 0 ? book?.sections?.[sectionIndex] : undefined;
    const currentId = section?.id ?? null;
    const embeddedText = getEmbeddedFootnoteText(anchor);
    if (!rawHref) {
      // Href-less marker: only Duokan-style embedded-text markers are
      // intercepted (the note text lives in the marker itself).
      if (embeddedText && (hasFootnoteMarkerClass(anchor) || anchor.querySelector('img'))) {
        return {
          rawHref: '', fragment: '', targetPath: currentId ?? '', crossDocument: false,
          sectionIndex, isExplicitNoteref: false, semanticType: 'heuristic',
          targetElement: null, embeddedText,
        };
      }
      return null;
    }
    if (FOOTNOTE_EXTERNAL_SCHEME_RE.test(rawHref)) return null;
    const hashIndex = rawHref.indexOf('#');
    if (hashIndex < 0) return null;
    const fragment = decodeFootnoteFragment(rawHref.slice(hashIndex + 1));
    if (!fragment) return null;
    const rawPath = rawHref.slice(0, hashIndex);
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
      if (!targetElement) {
        // Duokan-style: the note text is embedded in the marker itself,
        // so no target element is needed.
        if (embeddedText) {
          return {
            rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref,
            semanticType: isExplicitNoteref ? anchorSemanticType : 'heuristic',
            targetElement: null, embeddedText,
          };
        }
        if (isExplicitNoteref) {
          // Explicit noteref with an unresolvable target: fall back to the
          // EPUB's default navigation instead of swallowing the tap.
          if (__DEV__) console.log('[FOOTNOTE_TARGET_MISSING]', JSON.stringify({ rawHref, sectionIndex }));
        }
        return null;
      }
      if (isExplicitNoteref) {
        return { rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref, semanticType: anchorSemanticType, targetElement, embeddedText };
      }
      if (isFootnoteTargetElement(targetElement)) {
        return { rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref, semanticType: getFootnoteSemanticType(targetElement)!, targetElement, embeddedText };
      }
      // Heuristic fallback (exclusion-based): non-semantic links that look
      // like footnote references (plain `<a href="#fn1">1</a>` in real-world
      // books) pop over by default; only navigational shapes (TOC/nav,
      // headings, backlinks, notes-area taps) keep default navigation. The
      // empty-content guard in the click handler still applies, so a tap is
      // never swallowed when nothing extractable exists.
      const body = resolveFootnoteBody(targetElement);
      if (isHeuristicFootnoteReference(anchor, body)) {
        if (__DEV__) console.log('[FOOTNOTE_HEURISTIC]', JSON.stringify({ rawHref, sectionIndex }));
        return { rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref, semanticType: 'heuristic', targetElement: body, embeddedText };
      }
      return null;
    }

    // Cross-document: explicit noterefs (the stable standard path), plus the
    // heuristic path for Kindle-style semantic-less endnotes (marker-like
    // label; the target document is verified after loading, with default
    // navigation as fallback).
    if (isExplicitNoteref) {
      return { rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref, semanticType: anchorSemanticType, targetElement: null, embeddedText };
    }
    if (isHeuristicCrossDocFootnoteReference(anchor)) {
      if (__DEV__) console.log('[FOOTNOTE_HEURISTIC_XDOC]', JSON.stringify({ rawHref, sectionIndex }));
      return { rawHref, fragment, targetPath, crossDocument, sectionIndex, isExplicitNoteref, semanticType: 'heuristic', targetElement: null, embeddedText };
    }
    return null;
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
      if (targetElement && !ref.isExplicitNoteref) {
        // Cross-document heuristic: verify the loaded target actually looks
        // like a footnote; otherwise fall through to the navigation fallback
        // below so the tap is never swallowed.
        const body = resolveFootnoteBody(targetElement);
        if (isHeuristicCrossDocFootnoteTarget(body, anchor)) {
          targetElement = body;
        } else {
          if (__DEV__) console.log('[FOOTNOTE_HEURISTIC_XDOC_REJECT]', JSON.stringify({ rawHref: ref.rawHref }));
          targetElement = null;
        }
      }
      if (!targetElement && ref.embeddedText) {
        // Duokan-style embedded note text: synthesize a body element so the
        // normal extraction pipeline (cleaning, rich text, HTML) applies.
        const p = doc.createElement('p');
        p.textContent = ref.embeddedText;
        targetElement = p;
      }
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
    if (!targetElement && ref.embeddedText) {
      // Same-document embedded note text with no resolvable target.
      const p = doc.createElement('p');
      p.textContent = ref.embeddedText;
      targetElement = p;
    }
    if (!targetElement) return;
    // The cross-document path awaits I/O above; the reader may have paginated
    // meanwhile. Never open a popover against a detached anchor rect.
    if (!anchor.isConnected) {
      if (__DEV__) console.log('[FOOTNOTE_ANCHOR_GONE]', JSON.stringify({ rawHref: ref.rawHref }));
      return;
    }
    let extracted = extractFootnoteContent(targetElement, anchor.textContent ?? '', resolveCitingAnchorId(anchor));
    if (!extracted.text && ref.embeddedText) {
      // The target had no extractable content; fall back to the marker's
      // embedded note text instead of navigating away.
      const p = doc.createElement('p');
      p.textContent = ref.embeddedText;
      extracted = extractFootnoteContent(p, anchor.textContent ?? '', resolveCitingAnchorId(anchor));
    }
    const { text, richText, html } = extracted;
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
    // A tap outside the highlight delete bubble dismisses it. Taps inside
    // the bubble (the delete button) must not dismiss before click fires.
    // Cross-window instanceof is unreliable here; guard with nodeType like
    // the tap-target classification below.
    const downTarget = (event.target as Node | null)?.nodeType === 1 ? (event.target as Element) : null;
    if (this.highlightBubble && !downTarget?.closest('[data-reader-highlight-bubble]')) {
      this.dismissHighlightBubble();
    }
    const startedWhileTurning = this.interactionState === 'turning';
    this.pointerSession = {
      pointerId: event.pointerId,
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
    const screenDeltaX = event.screenX - session.startScreenX;
    const screenDeltaY = event.screenY - session.startScreenY;
    // Tap slop must be measured in visible-page (screen) coordinates, NOT
    // clientX/clientY: those live in the EPUB's scaled column canvas (e.g.
    // 2056px on a 430px iPhone page), so 10 canvas px was effectively ~2
    // screen px and ordinary taps were silently dropped. screenX is already
    // what the swipe detection below relies on.
    const movement = Math.hypot(screenDeltaX, screenDeltaY);
    const duration = event.timeStamp - session.startedAt;
    const selectionActive = this.hasActiveSelection(doc);
    // Section documents render inside iframes while this adapter runs in the
    // host window, so cross-window `instanceof Element` is always false for
    // `session.target`. Use nodeType (same approach as getSelectionElement)
    // so taps that start on links/buttons are correctly excluded from the
    // center-tap chrome gesture; otherwise every footnote tap in the center
    // zone fired onCenterTap() and chrome flashed before the popover opened.
    const target = (session.target as Node | null)?.nodeType === 1 ? (session.target as Element) : null;
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
    const absDeltaX = Math.abs(screenDeltaX);
    const absDeltaY = Math.abs(screenDeltaY);
    const isHorizontal = absDeltaX > absDeltaY * SWIPE_DIRECTION_DOMINANCE;
    // Velocity-based commit: a quick flick turns the page even if it didn't
    // travel the full distance threshold. duration is guarded against 0 so a
    // zero-time event can never produce an infinite velocity.
    const velocity = duration > 0 ? absDeltaX / duration : 0;
    const isHorizontalSwipe = isHorizontal && (
      absDeltaX >= SWIPE_MIN_DISTANCE_PX ||
      (absDeltaX >= SWIPE_FLICK_MIN_DISTANCE_PX && velocity >= SWIPE_FLICK_VELOCITY_PX_PER_MS)
    );
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
    // Modal footnote state: while a footnote popover (native or RN fallback)
    // is on screen, a tap only dismisses it — the system consumes the outside
    // tap for the native popover and the backdrop pressable handles it for
    // the fallback. Swallow every reader gesture here so the dismiss tap can
    // never turn the page or toggle chrome; normal gestures resume on the
    // next tap after dismissal.
    if (this.isFootnotePopoverOpen()) {
      if (__DEV__) console.log('[FOOTNOTE_MODAL_SUPPRESS]');
      return;
    }
    // Highlight tap: landing on a painted highlight opens the delete bubble
    // instead of turning the page or toggling chrome. Selection gestures,
    // interactive targets, and reflowing states keep their existing paths.
    if (isTap && !selectionActive && !session.selectionWasActive && !interactiveTarget && !blockedByState
      && this.view && this.restoreState === 'active') {
      const hitRangeCfi = this.hitTestHighlight(doc, event.clientX, event.clientY);
      if (hitRangeCfi) {
        this.interactionState = 'idle';
        this.showHighlightDeleteBubble(doc, hitRangeCfi, event.clientX, event.clientY);
        return;
      }
    }
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
    // A real turn just started: the optional background page counter must
    // wait for a new quiet window instead of racing this gesture.
    this.deferBackgroundPageCount();
    // Removing a temporary search marker must never add input latency to the
    // established page-turn pipeline.
    void this.clearSelectedSearchHighlight();
    let nextDirection: 'next' | 'prev' | null = direction;
    // Burst detection: the first turn keeps the cross-dissolve, but once a
    // queued turn exists the user is flipping fast — cut instantly instead
    // of serializing every turn on `transition.finished`.
    let instant = false;
    try {
      // Keep the lock for the entire burst. Starting a new View Transition
      // recursively in the same task that completed the previous one could
      // race WebKit's snapshot cleanup and intermittently drop frames.
      while (nextDirection) {
        // Stamp per turn: a queued opposite direction inside the same burst
        // must not inherit this turn's reason.
        this.pendingNavigationReason = nextDirection === 'next' ? 'reading-forward' : 'reading-backward';
        try {
          await this.turnWithCrossDissolve(nextDirection, instant);
        } finally {
          this.pendingNavigationReason = null;
        }
        const pendingTurn = this.takePendingPageTurn();
        if (!pendingTurn) break;
        instant = true;
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

  /**
   * Pre-warm the sections adjacent to `centerIndex` through foliate's own
   * section loader while the reader is idle. This only warms the loader's
   * blob-URL cache (zip inflate + resource rewrite); the iframe still loads
   * and lays out on the real turn. Each warmed section holds exactly one
   * loader refcount, released on arrival or when proven stale.
   */
  private prewarmAdjacentSections(centerIndex: number): void {
    const sections = this.view?.book?.sections;
    if (!sections || !this.view || this.restoreState !== 'active') return;
    for (const dir of [1, -1] as const) {
      const index = this.adjacentLinearSectionIndex(sections, centerIndex, dir);
      if (index === null || this.prewarmedSectionIndexes.has(index)) continue;
      try {
        const pending = sections[index]?.load?.();
        // Fire-and-forget: a rejection just means this section stays cold.
        if (pending instanceof Promise) pending.catch(() => {});
        // Recorded even if the load later rejects: unload() on a never-cached
        // href is a safe no-op inside foliate's loader, so the pair always
        // balances.
        this.prewarmedSectionIndexes.add(index);
      } catch {
        // A section that can't even start loading stays cold; the real turn
        // surfaces the error through foliate's normal path.
      }
    }
  }

  /** Mirror foliate's own adjacency: skip non-linear spine items. */
  private adjacentLinearSectionIndex(
    sections: FoliateSection[],
    from: number,
    dir: 1 | -1,
  ): number | null {
    for (let i = from + dir; i >= 0 && i < sections.length; i += dir) {
      if (sections[i]?.linear !== 'no') return i;
    }
    return null;
  }

  private releaseSectionPrewarm(index: number): void {
    if (!this.prewarmedSectionIndexes.delete(index)) return;
    try {
      this.view?.book?.sections?.[index]?.unload?.();
    } catch {
      // The loader refcount already settled; nothing to release.
    }
  }

  /**
   * Reconcile pre-warms after landing on `currentIndex`: release the one we
   * just arrived at (the turn's own load() reffed again) and any that are no
   * longer adjacent (TOC jumps, etc.). Then re-arm the idle timer.
   */
  private reconcileSectionPrewarms(currentIndex: number): void {
    const sections = this.view?.book?.sections;
    const keep = new Set<number>();
    if (sections) {
      for (const dir of [1, -1] as const) {
        const adjacent = this.adjacentLinearSectionIndex(sections, currentIndex, dir);
        if (adjacent !== null) keep.add(adjacent);
      }
    }
    for (const index of [...this.prewarmedSectionIndexes]) {
      if (index === currentIndex || !keep.has(index)) this.releaseSectionPrewarm(index);
    }
    this.scheduleSectionPrewarm(currentIndex);
  }

  private scheduleSectionPrewarm(centerIndex: number): void {
    this.cancelSectionPrewarm();
    this.sectionPrewarmTimer = window.setTimeout(() => {
      this.sectionPrewarmTimer = null;
      this.prewarmAdjacentSections(centerIndex);
    }, SECTION_PREWARM_IDLE_MS);
  }

  private cancelSectionPrewarm(): void {
    if (this.sectionPrewarmTimer !== null) {
      window.clearTimeout(this.sectionPrewarmTimer);
      this.sectionPrewarmTimer = null;
    }
  }

  private clearAllSectionPrewarms(): void {
    this.cancelSectionPrewarm();
    for (const index of [...this.prewarmedSectionIndexes]) this.releaseSectionPrewarm(index);
  }

  private async turnWithCrossDissolve(direction: 'next' | 'prev', instant = false) {
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
    // Burst (fast flipping), reduced motion, or no View Transition support:
    // cut straight to the next page with no snapshot animation.
    if (instant || this.prefersReducedMotion() || !startViewTransition) {
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
    // Engine-initiated reflow (rotation/host resize), not user reading:
    // rebase the forward segment instead of measuring.
    this.pendingNavigationReason = 'programmatic';
    try {
      await this.nextFrame();
      await this.view.goTo(cfi);
      await this.nextFrame();
      const location = this.getLocation();
      this.restoreState = 'active';
      this.onLocation(location, this.restoreState);
      this.scheduleBackgroundPageCount();
    } finally {
      this.pendingNavigationReason = null;
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
      // Typography/layout repagination reflows to the same CFI: rebase the
      // forward segment, never measure the reflow as reading progress.
      this.pendingNavigationReason = 'settings-repagination';
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
      this.pendingNavigationReason = null;
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

  /**
   * A real page turn just started. The background page counter is optional
   * display work — if its timer hasn't fired yet, push it out to a fresh
   * quiet window instead of letting it race this gesture. An already-running
   * count keeps its own per-section yielding via waitForVisibleTurnIdle.
   */
  private deferBackgroundPageCount() {
    if (this.pageCountCache || this.pageCountTimer === null || this.restoreState !== 'active') return;
    window.clearTimeout(this.pageCountTimer);
    this.pageCountTimer = null;
    this.scheduleBackgroundPageCount();
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

      // The counter book parse is the single heaviest synchronous chunk of
      // this job. Don't start it mid-gesture even if the timer already fired.
      if (!await this.waitForVisibleTurnIdle(run)) return;
      await this.nextIdleFrame();
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
        /* Default to justified text for EPUBs that don't set their own alignment.
           No !important so book CSS like text-align: center/left/right can still
           override the inherited value (titles, poetry, etc.). */
        text-align: justify;
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
        // Cross-window safe: childNodes come from the section iframe's
        // document, where `instanceof Element` (host window) is always false.
        if (node.nodeType !== 1) return false;
        if (node === media || (node as Element).contains(media)) return false;
        return true;
      });
      if (meaningfulChildren.length > 0) return;
      container.classList.add('reader-standalone-media');
      return;
    }
  }
}
