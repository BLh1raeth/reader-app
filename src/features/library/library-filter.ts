import type { Book } from './library-types';
export type LibraryFilter = 'all' | 'archived' | Book['readingStatus'] | `tag:${string}`;

export function filterLibraryBooks<T extends Book>(books: T[], filter: LibraryFilter, query: string): T[] {
  const needle = query.trim().normalize('NFC').toLocaleLowerCase();
  return books.filter((book) => {
    if (filter === 'archived' ? !book.archivedAt : Boolean(book.archivedAt)) return false;
    if (filter.startsWith('tag:') && !book.tags?.includes(filter.slice(4))) return false;
    if (filter !== 'all' && filter !== 'archived' && !filter.startsWith('tag:') && book.readingStatus !== filter) return false;
    return !needle || [book.title, book.author ?? '', ...(book.tags ?? [])]
      .some((text) => text.normalize('NFC').toLocaleLowerCase().includes(needle));
  });
}
