/**
 * Footnote detection for the EPUB reader engine.
 *
 * Pure DOM heuristics, extracted from FoliateEpubEngineAdapter: semantic
 * EPUB footnote markup first, then exclusion-based heuristics for
 * real-world non-semantic patterns (same-document links, Kindle-style
 * cross-document endnotes, Duokan embedded-text markers, Calibre dl/dd,
 * vendor class names), plus popover content extraction/cleanup.
 * No adapter instance state — safe to tune per-book without touching
 * the engine bridge.
 */
import type { FootnoteRichTextNode, FootnoteSemanticType } from '../reader-types';

// ── Footnote popover ──────────────────────────────────────────────
// Semantic-first footnote support: explicit EPUB footnote semantics are
// intercepted first; conservative heuristics then cover real-world
// non-semantic patterns (v2: same-document plain links; v3: Kindle-style
// cross-document endnotes, Duokan embedded-text markers, Calibre dl/dd,
// vendor class names). Non-footnote links keep default behavior; rejected
// taps always fall back to the EPUB's natural navigation, never swallowed.

export type FootnoteReference = {
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
export const FOOTNOTE_LEADING_NUMBER_RE = /^[0-9\s.\[\]()\-–—]+$/;
const FOOTNOTE_LEADING_NUMBER_PREFIX_RE = /^[0-9\s.\[\]()\-–—]+?(?=\s)/;
export const FOOTNOTE_EXTERNAL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
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

export function decodeFootnoteFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function findFragmentElement(doc: Document, fragment: string): Element | null {
  return doc.getElementById(fragment)
    ?? doc.querySelector(`[id="${CSS.escape(fragment)}"]`);
}

export function getFootnoteSemanticType(element: Element): FootnoteSemanticType | null {
  const epubType = element.getAttribute('epub:type');
  const role = element.getAttribute('role');
  if (epubType === 'footnote' || role === 'doc-footnote') return 'footnote-target';
  if (epubType === 'endnote' || role === 'doc-endnote') return 'endnote-target';
  return null;
}

export function isFootnoteTargetElement(element: Element): boolean {
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
export function isBacklinkAnchor(anchor: HTMLAnchorElement): boolean {
  const epubType = anchor.getAttribute('epub:type');
  const role = anchor.getAttribute('role');
  if (epubType === 'backlink' || epubType === 'referrer' || role === 'doc-backlink') return true;
  if (FOOTNOTE_BACKLINK_CLASS_RE.test(anchor.getAttribute('class') ?? '')) return true;
  return isBacklinkLabel(anchor.textContent ?? '');
}

/** True when the anchor carries a known footnote-marker class. */
export function hasFootnoteMarkerClass(anchor: HTMLAnchorElement): boolean {
  const tokens = (anchor.getAttribute('class') ?? '').toLowerCase().split(/\s+/);
  return tokens.some((token) => FOOTNOTE_MARKER_CLASSES.has(token));
}

/**
 * Duokan/Zhangyue-style embedded note text: the note lives in an image
 * attribute (`zy-footnote`, `data-footnote*`) inside the marker anchor,
 * with `alt` as fallback. Returns the text or null.
 */
export function getEmbeddedFootnoteText(anchor: HTMLAnchorElement): string | null {
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
export function resolveFootnoteBody(target: Element): Element {
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
export function resolveCitingAnchorId(anchor: HTMLAnchorElement): string | null {
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
export function isHeuristicFootnoteReference(
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
export function isHeuristicCrossDocFootnoteReference(anchor: HTMLAnchorElement): boolean {
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
export function isHeuristicCrossDocFootnoteTarget(target: Element, anchor: HTMLAnchorElement): boolean {
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

export function extractFootnoteContent(
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
