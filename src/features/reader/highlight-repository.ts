import { getLibraryDatabase } from '../library/library-database';

export type ReaderHighlightColor = 'blue';

export type ReaderHighlight = {
  id: number;
  bookId: string;
  text: string;
  startCfi: string;
  endCfi: string;
  rangeCfi: string;
  chapterTitle: string | null;
  sectionIndex: number;
  color: ReaderHighlightColor;
  createdAt: string;
  updatedAt: string;
};

export type NewReaderHighlight = Omit<ReaderHighlight, 'id' | 'createdAt' | 'updatedAt'>;

export type ReaderHighlightSnapshotItem = {
  rangeCfi: string;
  sectionIndex: number;
};

type ReaderHighlightRow = {
  id: number;
  book_id: string;
  text: string;
  start_cfi: string;
  end_cfi: string;
  range_cfi: string;
  chapter_title: string | null;
  section_index: number;
  color: string;
  created_at: string;
  updated_at: string;
};

function mapRow(row: ReaderHighlightRow): ReaderHighlight {
  return {
    id: row.id,
    bookId: row.book_id,
    text: row.text,
    startCfi: row.start_cfi,
    endCfi: row.end_cfi,
    rangeCfi: row.range_cfi,
    chapterTitle: row.chapter_title,
    sectionIndex: row.section_index,
    color: (row.color === 'blue' ? 'blue' : 'blue') as ReaderHighlightColor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findHighlightByRange(bookId: string, rangeCfi: string) {
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<ReaderHighlightRow>(
    'SELECT * FROM reader_highlights WHERE book_id = ? AND range_cfi = ?;',
    bookId,
    rangeCfi,
  );
  return row ? mapRow(row) : null;
}

export const highlightRepository = {
  async createHighlight(highlight: NewReaderHighlight) {
    const database = await getLibraryDatabase();
    const now = new Date().toISOString();
    const result = await database.runAsync(
      `INSERT INTO reader_highlights (
        book_id, text, start_cfi, end_cfi, range_cfi,
        chapter_title, section_index, color, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, range_cfi) DO NOTHING;`,
      highlight.bookId,
      highlight.text,
      highlight.startCfi,
      highlight.endCfi,
      highlight.rangeCfi,
      highlight.chapterTitle,
      highlight.sectionIndex,
      highlight.color,
      now,
      now,
    );
    const persisted = await findHighlightByRange(highlight.bookId, highlight.rangeCfi);
    if (!persisted) throw new Error('高亮写入后无法重新读取。');
    return { highlight: persisted, created: result.changes > 0 };
  },

  async getHighlightById(id: number) {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<ReaderHighlightRow>(
      'SELECT * FROM reader_highlights WHERE id = ?;',
      id,
    );
    return row ? mapRow(row) : null;
  },

  async findByRange(bookId: string, rangeCfi: string) {
    return findHighlightByRange(bookId, rangeCfi);
  },

  async listHighlightsForBook(bookId: string) {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<ReaderHighlightRow>(
      `SELECT * FROM reader_highlights
       WHERE book_id = ?
       ORDER BY section_index ASC, created_at ASC, id ASC;`,
      bookId,
    );
    return rows.map(mapRow);
  },

  async listSnapshotForBook(bookId: string): Promise<ReaderHighlightSnapshotItem[]> {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<{ range_cfi: string; section_index: number }>(
      `SELECT range_cfi, section_index FROM reader_highlights
       WHERE book_id = ?
       ORDER BY section_index ASC, id ASC;`,
      bookId,
    );
    return rows.map((row) => ({ rangeCfi: row.range_cfi, sectionIndex: row.section_index }));
  },

  async deleteHighlight(id: number) {
    const database = await getLibraryDatabase();
    await database.runAsync('DELETE FROM reader_highlights WHERE id = ?;', id);
  },

  async deleteHighlightByRange(bookId: string, rangeCfi: string) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      'DELETE FROM reader_highlights WHERE book_id = ? AND range_cfi = ?;',
      bookId,
      rangeCfi,
    );
  },
};
