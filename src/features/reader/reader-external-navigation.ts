/**
 * Excerpts Tab Core C: one-shot pending external navigation requests.
 *
 * Tapping an excerpt's Source row ("《书名》 · 章节") asks the Reader to open
 * the book and jump straight to the excerpt's range CFI with a transient
 * emphasis. The request travels in memory only — never in the URL, never in
 * storage — so a killed app can never replay a stale request.
 *
 * Semantics:
 * - At most one request is pending at a time; a newer tap overwrites an
 *   older one (rapid taps on different items never cross-contaminate: take()
 *   only hands the request to the matching bookId).
 * - take() is one-shot: a rerender, settings change, or background/foreground
 *   cycle can never consume the same request twice.
 * - Requests older than EXTERNAL_NAVIGATION_REQUEST_TTL_MS are dropped on
 *   take(), so a request that somehow outlives its navigation is inert.
 */

export type ReaderExternalNavigationRequest = {
  /** Monotonic id, used to match async results to the request that caused them. */
  id: number;
  bookId: string;
  rangeCfi: string;
  /** Locked: external excerpt jumps are always annotation-style jumps. */
  reason: 'annotation';
  /** Locked: the jump is always paired with a transient reveal. */
  reveal: true;
  createdAt: number;
};

/** A pending request that was never consumed is inert after this long. */
export const EXTERNAL_NAVIGATION_REQUEST_TTL_MS = 5 * 60 * 1000;

let nextRequestId = 1;
let pendingRequest: ReaderExternalNavigationRequest | null = null;

function isCfiLike(value: string): boolean {
  return value.startsWith('epubcfi(');
}

/**
 * Publish a new external navigation request, replacing any older pending one.
 * Throws when the range CFI is malformed so callers fail before navigating.
 */
export function createReaderExternalNavigationRequest(
  bookId: string,
  rangeCfi: string,
): ReaderExternalNavigationRequest {
  if (!bookId || !isCfiLike(rangeCfi)) {
    throw new Error('无法定位到原摘录位置。');
  }
  const request: ReaderExternalNavigationRequest = {
    id: nextRequestId++,
    bookId,
    rangeCfi,
    reason: 'annotation',
    reveal: true,
    createdAt: Date.now(),
  };
  pendingRequest = request;
  return request;
}

/**
 * Atomically take the pending request for a book. Returns null when there is
 * no pending request, it belongs to another book, or it expired. Taking
 * clears the slot, so the same request can never be consumed twice.
 */
export function takeReaderExternalNavigationRequest(
  bookId: string,
): ReaderExternalNavigationRequest | null {
  const request = pendingRequest;
  if (!request) return null;
  const expired = Date.now() - request.createdAt > EXTERNAL_NAVIGATION_REQUEST_TTL_MS;
  if (request.bookId !== bookId || expired) {
    if (expired) pendingRequest = null;
    return null;
  }
  pendingRequest = null;
  return request;
}

/** Test/debug helper: drop the pending request without consuming it. */
export function clearReaderExternalNavigationRequest(): void {
  pendingRequest = null;
}
