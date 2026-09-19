import { getLibraryDatabase } from '../library/library-database';

/**
 * A pagination result is deliberately scoped to one concrete reader layout.
 * Its values are UI aids only; EPUB CFI remains the persistent location.
 */
export type ReaderPageCountCache = {
  bookId: string;
  layoutSignature: string;
  totalPages: number;
  sectionPages: number[];
  updatedAt: string;
};

type ReaderPageCountCacheRow = {
  book_id: string;
  layout_signature: string;
  total_pages: number;
  section_pages_json: string;
  updated_at: string;
};

function mapRow(row: ReaderPageCountCacheRow): ReaderPageCountCache | null {
  try {
    const sectionPages = JSON.parse(row.section_pages_json);
    // Empty spine entries are valid in real EPUBs. They have zero visual
    // pages, but must remain in the array so every later spine offset stays
    // aligned with foliate's section index.
    if (!Array.isArray(sectionPages) || !sectionPages.length || !sectionPages.every((value) => Number.isInteger(value) && value >= 0)) {
      return null;
    }
    if (!Number.isInteger(row.total_pages) || row.total_pages <= 0) return null;
    return {
      bookId: row.book_id,
      layoutSignature: row.layout_signature,
      totalPages: row.total_pages,
      sectionPages,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export const readerPageCacheRepository = {
  /** The DOM reader validates the layout signature before it consumes this. */
  async getMostRecent(bookId: string) {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<ReaderPageCountCacheRow>(
      `SELECT * FROM reader_page_cache
       WHERE book_id = ?
       ORDER BY updated_at DESC
       LIMIT 1;`,
      bookId,
    );
    return row ? mapRow(row) : null;
  },

  async upsert(cache: ReaderPageCountCache) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      `INSERT INTO reader_page_cache (
        book_id, layout_signature, total_pages, section_pages_json, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(book_id, layout_signature) DO UPDATE SET
        total_pages = excluded.total_pages,
        section_pages_json = excluded.section_pages_json,
        updated_at = excluded.updated_at;`,
      cache.bookId,
      cache.layoutSignature,
      cache.totalPages,
      JSON.stringify(cache.sectionPages),
      cache.updatedAt,
    );
  },
};
