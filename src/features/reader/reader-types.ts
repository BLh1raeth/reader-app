/**
 * Plain, bridge-safe Reader Core values. These intentionally do not expose
 * foliate-js classes to the native screen or to SQLite.
 */
export type ReaderLocation = {
  cfi: string;
  spineIndex: number;
  /** foliate's resolved EPUB TOC node for the visible range. */
  tocItemId: number | null;
  /** A 0-100 layout-independent estimate supplied by foliate-js. */
  percentage: number;
  currentPage: number | null;
  totalPages: number | null;
};

/**
 * A Reader session is deliberately inert until a requested CFI has either
 * settled or cleanly fallen back. Only `active` locations may be persisted.
 */
export type ReaderRestoreState = 'opening' | 'restoring' | 'active';

export type ReaderEngineDiagnostic =
  | { event: 'DOM_READY' }
  | { event: 'EPUB_TRANSFER_END' }
  | { event: 'FOLIATE_OPEN_START' }
  | { event: 'FOLIATE_IMPORT_START' }
  | { event: 'FOLIATE_IMPORT_END' }
  | { event: 'BOOK_BUILD_START' }
  | { event: 'BOOK_BUILD_END' }
  | { event: 'BOOK_OPEN_START' }
  | { event: 'BOOK_OPEN_END' }
  | { event: 'ENGINE_OPENED' }
  | { event: 'STYLE_APPLY_START' }
  | { event: 'STYLE_APPLY_END' }
  | { event: 'VIEW_INIT_START' }
  | { event: 'VIEW_INIT_END' }
  | { event: 'PAGINATION_START' }
  | { event: 'PAGINATION_END' }
  | { event: 'RESTORE_REQUEST'; targetCfi: string | null }
  | { event: 'RESTORE_RESULT'; targetCfi: string | null; actualCurrentCfi: string | null }
  | { event: 'FIRST_PAGE_RENDERED' }
  | { event: 'ENGINE_DESTROY' };

export type ReaderZipEntry = {
  name: string;
  compressedSize: number;
  compressionMethod: 0 | 8;
  localHeaderOffset: number;
  uncompressedSize: number;
};

export type ReaderResourcePayload = {
  base64: string;
};

export type ReaderEpubSource = {
  bookId: string;
  sessionId: string;
  fileName: string;
  byteLength: number;
  /** The complete EPUB is present only in compatibility fallback mode. */
  base64?: string;
  entries?: ReaderZipEntry[];
  /**
   * Small metadata files foliate needs at open time (container.xml, the OPF
   * package document, encryption.xml, NCX/EPUB3 nav), read natively from the
   * already-loaded bytes. Keyed by the exact ZIP entry names foliate
   * requests, so the DOM side can answer without bridge round trips.
   */
  prefetchedText?: Record<string, string>;
  sourceKind: 'zip-resource-loader' | 'full-base64-fallback';
  sourceReadMs: number;
};

export type ReaderTocItem = {
  id: number | null;
  label: string;
  href: string;
  spineIndex: number | null;
  subitems?: ReaderTocItem[];
};

export type ReaderTocNavigationRequest = {
  id: number;
  href: string;
};

export type ReaderBookmarkAnchor = {
  id: number;
  cfi: string;
  spineIndex: number;
};

export type ReaderBookmarkSnapshot = {
  cfi: string;
  spineIndex: number;
  sectionFraction: number;
  pageNumber: number | null;
  layoutSignature: string | null;
  chapterTitle: string | null;
  excerpt: string;
  matchedBookmarkId: number | null;
};

export type ReaderBookmarkSnapshotRequest = {
  id: number;
  intent: 'status' | 'toggle';
  bookmarks: ReaderBookmarkAnchor[];
};

export type ReaderBookmarkNavigationRequest = {
  id: number;
  cfi: string;
};

export type ReaderPageLocationTarget = {
  key: string;
  destination: string;
};

export type ReaderPageLocationRequest = {
  id: number;
  layoutSignature: string;
  targets: ReaderPageLocationTarget[];
};

export type ReaderPageLocationResult = {
  key: string;
  destination: string;
  pageNumber: number;
};

export type ReaderSearchExcerpt = {
  pre: string;
  match: string;
  post: string;
};

export type ReaderSearchResult = {
  id: string;
  cfi: string;
  spineIndex: number;
  chapterTitle: string | null;
  /** Layout-dependent whole-book page. Null until the current page cache is ready. */
  pageNumber: number | null;
  excerpt: ReaderSearchExcerpt;
};

export type ReaderSearchRequest = {
  id: number;
  query: string;
};

export type ReaderSearchNavigationRequest = {
  id: number;
  cfi: string;
};

export type ReaderSelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The bridge-safe, transient entry point for future excerpt, highlight, and
 * note features. EPUB CFI values are the anchors; page numbers are deliberately
 * absent because they change whenever the Reader layout changes.
 */
export type ReaderSelectionPayload = {
  bookId: string;
  text: string;
  startCfi: string;
  endCfi: string;
  rangeCfi: string;
  chapterTitle: string | null;
  sectionIndex: number;
  rect: ReaderSelectionRect;
};

export type ReaderSelectionCommand = {
  id: number;
  type: 'clear';
};

export type ReaderSelectionAction = 'excerpt' | 'highlight' | 'note' | 'searchInBook';

export type ReaderSelectionActionEvent = {
  nativeEvent: {
    action: ReaderSelectionAction;
  };
};

export type ReaderSearchInitialQueryRequest = {
  id: number;
  query: string;
};

export type ReaderExcerptVerificationItem = {
  excerptId: number;
  text: string;
  rangeCfi: string;
};

export type ReaderExcerptVerificationRequest = {
  id: number;
  items: ReaderExcerptVerificationItem[];
};

export type FootnoteAnchorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FootnoteSemanticType = 'noteref' | 'doc-noteref' | 'footnote-target' | 'endnote-target';

/**
 * Whitelist-based rich text tree for footnote content. Built only from an
 * explicit tag allowlist (em/i, strong/b, br, paragraphs, links), so no
 * script, event handler, or arbitrary active content can survive extraction.
 */
export type FootnoteRichTextNode =
  | { kind: 'text'; text: string }
  | { kind: 'em'; children: FootnoteRichTextNode[] }
  | { kind: 'strong'; children: FootnoteRichTextNode[] }
  | { kind: 'break' }
  | { kind: 'paragraph'; children: FootnoteRichTextNode[] }
  | { kind: 'link'; href: string; children: FootnoteRichTextNode[] };

export type FootnotePayload = {
  id?: string;
  text: string;
  richText: FootnoteRichTextNode[];
  /** Sanitized limited HTML regenerated from the rich-text whitelist. */
  html?: string;
  sourceHref?: string;
  anchorRect: FootnoteAnchorRect;
  crossDocument: boolean;
  semanticType: FootnoteSemanticType;
};
