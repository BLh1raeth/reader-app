import { getLibraryDatabase } from '../library/library-database';

export type ReadingProgress = {
  bookId: string;
  cfi: string;
  spineIndex: number;
  percentage: number;
  currentPage: number | null;
  totalPages: number | null;
  updatedAt: string;
};

type ReadingProgressRow = {
  book_id: string;
  location: string;
  cfi: string | null;
  spine_index: number;
  percentage: number;
  current_page: number | null;
  total_pages: number | null;
  updated_at: string;
};

function mapRow(row: ReadingProgressRow): ReadingProgress {
  return {
    bookId: row.book_id,
    // `location` is retained for the legacy prototype migration only. New
    // Reader Core writes the same CFI to both columns during the transition.
    cfi: row.cfi ?? row.location,
    spineIndex: row.spine_index,
    percentage: row.percentage,
    currentPage: row.current_page,
    totalPages: row.total_pages,
    updatedAt: row.updated_at,
  };
}

export const readingProgressRepository = {
  async getByBookId(bookId: string) {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<ReadingProgressRow>(
      'SELECT * FROM reading_progress WHERE book_id = ?;',
      bookId,
    );
    return row ? mapRow(row) : null;
  },

  async upsert(progress: ReadingProgress) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      `INSERT INTO reading_progress (
        book_id, location, cfi, spine_index, block_index, character_offset, percentage, current_page, total_pages, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        location = excluded.location,
        cfi = excluded.cfi,
        spine_index = excluded.spine_index,
        percentage = excluded.percentage,
        current_page = excluded.current_page,
        total_pages = excluded.total_pages,
        updated_at = excluded.updated_at;`,
      progress.bookId,
      progress.cfi,
      progress.cfi,
      progress.spineIndex,
      progress.percentage,
      progress.currentPage,
      progress.totalPages,
      progress.updatedAt,
    );
  },
};
