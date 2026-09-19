import { getLibraryDatabase } from '../library/library-database';

export type BookSearchHistoryItem = {
  query: string;
  searchedAt: string;
};

type BookSearchHistoryRow = {
  query: string;
  searched_at: string;
};

const MAX_RECENT_SEARCHES = 8;

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, ' ');
}

export const bookSearchHistoryRepository = {
  async list(bookId: string) {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<BookSearchHistoryRow>(
      `SELECT query, searched_at
       FROM book_search_history
       WHERE book_id = ?
       ORDER BY searched_at DESC
       LIMIT ?;`,
      bookId,
      MAX_RECENT_SEARCHES,
    );
    return rows.map((row): BookSearchHistoryItem => ({
      query: row.query,
      searchedAt: row.searched_at,
    }));
  },

  async record(bookId: string, rawQuery: string) {
    const query = normalizeQuery(rawQuery);
    if (!query) return this.list(bookId);
    const queryKey = query.toLocaleLowerCase();
    const searchedAt = new Date().toISOString();
    const database = await getLibraryDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO book_search_history (book_id, query_key, query, searched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(book_id, query_key) DO UPDATE SET
           query = excluded.query,
           searched_at = excluded.searched_at;`,
        bookId,
        queryKey,
        query,
        searchedAt,
      );
      await transaction.runAsync(
        `DELETE FROM book_search_history
         WHERE book_id = ?
           AND query_key NOT IN (
             SELECT query_key
             FROM book_search_history
             WHERE book_id = ?
             ORDER BY searched_at DESC
             LIMIT ?
           );`,
        bookId,
        bookId,
        MAX_RECENT_SEARCHES,
      );
    });
    return this.list(bookId);
  },

  async clear(bookId: string) {
    const database = await getLibraryDatabase();
    await database.runAsync('DELETE FROM book_search_history WHERE book_id = ?;', bookId);
  },
};
