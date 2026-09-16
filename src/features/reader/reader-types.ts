/**
 * Plain, bridge-safe Reader Core values. These intentionally do not expose
 * foliate-js classes to the native screen or to SQLite.
 */
export type ReaderLocation = {
  cfi: string;
  spineIndex: number;
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
  | { event: 'ENGINE_OPENED' }
  | { event: 'RESTORE_REQUEST'; targetCfi: string | null }
  | { event: 'RESTORE_RESULT'; targetCfi: string | null; actualCurrentCfi: string | null }
  | { event: 'FIRST_PAGE_RENDERED' }
  | { event: 'LOCATION_CHANGED'; cfi: string | null; restoreState: ReaderRestoreState }
  | { event: 'ENGINE_DESTROY' };

export type ReaderEpubSource = {
  sessionId: string;
  fileName: string;
  byteLength: number;
  /** Kept inside the bridge layer; the engine only receives a File. */
  base64: string;
  sourceKind: 'memory-cache' | 'file-read';
  sourceReadMs: number;
};

export type ReaderTocItem = {
  label: string;
  href: string;
  subitems?: ReaderTocItem[];
};
