import { getLibraryDatabase } from '../library/library-database';

export type ReaderBookmark = {
  id: number;
  bookId: string;
  cfi: string;
  spineIndex: number;
  sectionFraction: number;
  pageNumber: number | null;
  layoutSignature: string | null;
  chapterTitle: string | null;
  excerpt: string;
  createdAt: string;
};

export type NewReaderBookmark = Omit<ReaderBookmark, 'id' | 'createdAt'>;

type ReaderBookmarkRow = {
  id: number;
  book_id: string;
  cfi: string;
  spine_index: number;
  section_fraction: number;
  page_number: number | null;
  layout_signature: string | null;
  chapter_title: string | null;
  excerpt: string;
  created_at: string;
};

function mapRow(row: ReaderBookmarkRow): ReaderBookmark {
  return {
    id: row.id,
    bookId: row.book_id,
    cfi: row.cfi,
    spineIndex: row.spine_index,
    sectionFraction: row.section_fraction,
    pageNumber: row.page_number,
    layoutSignature: row.layout_signature,
    chapterTitle: row.chapter_title,
    excerpt: row.excerpt,
    createdAt: row.created_at,
  };
}

export const bookmarkRepository = {
  async list(bookId: string) {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<ReaderBookmarkRow>(
      `SELECT *
       FROM reader_bookmarks
       WHERE book_id = ?
       ORDER BY spine_index ASC, section_fraction ASC, created_at ASC;`,
      bookId,
    );
    return rows.map(mapRow);
  },

  async create(bookmark: NewReaderBookmark) {
    const database = await getLibraryDatabase();
    const createdAt = new Date().toISOString();
    await database.runAsync(
      `INSERT INTO reader_bookmarks (
        book_id, cfi, spine_index, section_fraction, page_number, layout_signature,
        chapter_title, excerpt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, cfi) DO UPDATE SET
        spine_index = excluded.spine_index,
        section_fraction = excluded.section_fraction,
        page_number = excluded.page_number,
        layout_signature = excluded.layout_signature,
        chapter_title = excluded.chapter_title,
        excerpt = excluded.excerpt;`,
      bookmark.bookId,
      bookmark.cfi,
      bookmark.spineIndex,
      bookmark.sectionFraction,
      bookmark.pageNumber,
      bookmark.layoutSignature,
      bookmark.chapterTitle,
      bookmark.excerpt,
      createdAt,
    );
  },

  async updateLayoutPage(id: number, bookId: string, pageNumber: number, layoutSignature: string) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      `UPDATE reader_bookmarks
       SET page_number = ?, layout_signature = ?
       WHERE id = ? AND book_id = ?;`,
      pageNumber,
      layoutSignature,
      id,
      bookId,
    );
  },

  async remove(id: number, bookId: string) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      'DELETE FROM reader_bookmarks WHERE id = ? AND book_id = ?;',
      id,
      bookId,
    );
  },
};
