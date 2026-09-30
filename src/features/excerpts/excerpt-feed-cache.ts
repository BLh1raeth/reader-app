import { listExcerptFeedItems, type ExcerptFeedItem } from './excerpt-feed-repository';

// Native Tabs may mount the tab before it is selected, or only on first visit.
// Start the small SQLite read while the library is visible and publish the
// result to both already-mounted and later-mounted Excerpts screens.
let snapshot: ExcerptFeedItem[] | null = null;
let inFlight: Promise<ExcerptFeedItem[]> | null = null;
const listeners = new Set<() => void>();

function sameFeed(left: ExcerptFeedItem[], right: ExcerptFeedItem[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const next = right[index];
    return item.id === next.id
      && item.kind === next.kind
      && item.bookId === next.bookId
      && item.bookTitle === next.bookTitle
      && item.chapterTitle === next.chapterTitle
      && item.quoteText === next.quoteText
      && item.noteText === next.noteText
      && item.rangeCfi === next.rangeCfi
      && item.createdAt === next.createdAt
      && item.updatedAt === next.updatedAt;
  });
}

export function getExcerptFeedSnapshot(): ExcerptFeedItem[] | null {
  return snapshot;
}

export function subscribeExcerptFeed(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function refreshExcerptFeed(): Promise<ExcerptFeedItem[]> {
  if (inFlight) return inFlight;
  const request = listExcerptFeedItems();
  inFlight = request;
  void request.then(
    (items) => {
      if (snapshot === null || !sameFeed(snapshot, items)) {
        snapshot = items;
        for (const listener of listeners) listener();
      }
      if (inFlight === request) inFlight = null;
    },
    () => {
      if (inFlight === request) inFlight = null;
    },
  );
  return request;
}

export function prefetchExcerptFeed(): Promise<ExcerptFeedItem[]> {
  return snapshot === null ? refreshExcerptFeed() : Promise.resolve(snapshot);
}
