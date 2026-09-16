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

export type ReaderEpubSource = {
  sessionId: string;
  fileName: string;
  byteLength: number;
  base64: string;
};

export type ReaderTocItem = {
  label: string;
  href: string;
  subitems?: ReaderTocItem[];
};
