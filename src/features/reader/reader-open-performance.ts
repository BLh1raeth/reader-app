export type ReaderOpenStage =
  | 'BOOK_TAP'
  | 'READER_ROUTE_MOUNTED'
  | 'BOOK_DATA_READY'
  | 'EPUB_FILE_READ_START'
  | 'EPUB_FILE_READ_END'
  | 'DOM_MOUNT_START'
  | 'DOM_READY'
  | 'EPUB_TRANSFER_START'
  | 'EPUB_TRANSFER_END'
  | 'FOLIATE_OPEN_START'
  | 'FOLIATE_OPEN_END'
  | 'RESTORE_START'
  | 'RESTORE_END'
  | 'FIRST_PAGE_RENDERED'
  | 'READER_VISIBLE';

type ReaderOpenTrace = {
  bookId: string;
  fileSize: number | null;
  startedAt: number;
  lastAt: number;
  marks: Partial<Record<ReaderOpenStage, number>>;
};

let activeTrace: ReaderOpenTrace | null = null;

function now() {
  return Date.now();
}

function ensureTrace(bookId: string, fileSize?: number | null) {
  if (!activeTrace || activeTrace.bookId !== bookId) {
    const timestamp = now();
    activeTrace = { bookId, fileSize: fileSize ?? null, startedAt: timestamp, lastAt: timestamp, marks: {} };
  }
  if (typeof fileSize === 'number') activeTrace.fileSize = fileSize;
  return activeTrace;
}

/** A native-JS-only timeline. DOM reports named milestones back to this clock. */
export function markReaderOpen(bookId: string, stage: ReaderOpenStage, fileSize?: number | null, extra: Record<string, unknown> = {}) {
  const trace = ensureTrace(bookId, fileSize);
  const timestamp = now();
  trace.marks[stage] = timestamp;
  const payload = {
    stage,
    timestamp,
    sincePreviousMs: timestamp - trace.lastAt,
    sinceTapMs: timestamp - trace.startedAt,
    bookId,
    fileSize: trace.fileSize,
    ...extra,
  };
  trace.lastAt = timestamp;
  console.log('[READER_PERF]', JSON.stringify(payload));
  if (stage === 'READER_VISIBLE') reportReaderOpen(bookId);
}

export function beginReaderOpen(bookId: string, fileSize: number) {
  activeTrace = null;
  markReaderOpen(bookId, 'BOOK_TAP', fileSize);
}

export function reportReaderOpen(bookId: string) {
  const trace = activeTrace;
  if (!trace || trace.bookId !== bookId) return;
  const order: ReaderOpenStage[] = [
    'BOOK_TAP', 'READER_ROUTE_MOUNTED', 'BOOK_DATA_READY', 'EPUB_FILE_READ_START', 'EPUB_FILE_READ_END', 'DOM_MOUNT_START', 'DOM_READY',
    'EPUB_TRANSFER_START', 'EPUB_TRANSFER_END', 'FOLIATE_OPEN_START', 'FOLIATE_OPEN_END',
    'RESTORE_START', 'RESTORE_END', 'FIRST_PAGE_RENDERED', 'READER_VISIBLE',
  ];
  const durations = order.flatMap((stage, index) => {
    const current = trace.marks[stage];
    const previous = index ? trace.marks[order[index - 1]] : current;
    return current === undefined || previous === undefined ? [] : [{ stage, ms: current - previous }];
  });
  console.log('[READER_OPEN_PERFORMANCE]', JSON.stringify({
    bookId,
    fileSize: trace.fileSize,
    totalMs: (trace.marks.READER_VISIBLE ?? now()) - trace.startedAt,
    stages: durations,
  }));
}
