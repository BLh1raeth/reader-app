import { getLibraryDatabase } from '../library/library-database';

export type ReaderExcerpt = {
  id: number;
  bookId: string;
  text: string;
  startCfi: string;
  endCfi: string;
  rangeCfi: string;
  chapterTitle: string | null;
  sectionIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type NewReaderExcerpt = Omit<ReaderExcerpt, 'id' | 'createdAt' | 'updatedAt'>;

type ReaderExcerptRow = {
  id: number;
  book_id: string;
  text: string;
  start_cfi: string;
  end_cfi: string;
  range_cfi: string;
  chapter_title: string | null;
  section_index: number;
  created_at: string;
  updated_at: string;
};

function mapRow(row: ReaderExcerptRow): ReaderExcerpt {
  return {
    id: row.id,
    bookId: row.book_id,
    text: row.text,
    startCfi: row.start_cfi,
    endCfi: row.end_cfi,
    rangeCfi: row.range_cfi,
    chapterTitle: row.chapter_title,
    sectionIndex: row.section_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findExcerptByRange(bookId: string, rangeCfi: string) {
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<ReaderExcerptRow>(
    'SELECT * FROM reader_excerpts WHERE book_id = ? AND range_cfi = ?;',
    bookId,
    rangeCfi,
  );
  return row ? mapRow(row) : null;
}

export const excerptRepository = {
  async createExcerpt(excerpt: NewReaderExcerpt) {
    const database = await getLibraryDatabase();
    const now = new Date().toISOString();
    const result = await database.runAsync(
      `INSERT INTO reader_excerpts (
        book_id, text, start_cfi, end_cfi, range_cfi,
        chapter_title, section_index, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, range_cfi) DO NOTHING;`,
      excerpt.bookId,
      excerpt.text,
      excerpt.startCfi,
      excerpt.endCfi,
      excerpt.rangeCfi,
      excerpt.chapterTitle,
      excerpt.sectionIndex,
      now,
      now,
    );
    const persisted = await findExcerptByRange(excerpt.bookId, excerpt.rangeCfi);
    if (!persisted) throw new Error('摘录写入后无法重新读取。');
    return { excerpt: persisted, created: result.changes > 0 };
  },

  async getExcerptById(id: number) {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<ReaderExcerptRow>(
      'SELECT * FROM reader_excerpts WHERE id = ?;',
      id,
    );
    return row ? mapRow(row) : null;
  },

  async findByRange(bookId: string, rangeCfi: string) {
    return findExcerptByRange(bookId, rangeCfi);
  },

  async listExcerptsForBook(bookId: string) {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<ReaderExcerptRow>(
      `SELECT * FROM reader_excerpts
       WHERE book_id = ?
       ORDER BY created_at DESC, id DESC;`,
      bookId,
    );
    return rows.map(mapRow);
  },

  async listAllExcerpts() {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<ReaderExcerptRow>(
      'SELECT * FROM reader_excerpts ORDER BY created_at DESC, id DESC;',
    );
    return rows.map(mapRow);
  },

  async deleteExcerpt(id: number) {
    const database = await getLibraryDatabase();
    await database.runAsync('DELETE FROM reader_excerpts WHERE id = ?;', id);
  },
};
