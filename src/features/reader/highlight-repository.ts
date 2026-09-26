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
  /** Nullable note attached 1:1 to this highlight (DB v19). */
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewReaderHighlight = Omit<ReaderHighlight, 'id' | 'createdAt' | 'updatedAt'>;

export type ReaderHighlightSnapshotItem = {
  rangeCfi: string;
  sectionIndex: number;
  /** True when the highlight carries a note; the DOM tap layer uses this to
      route the tap to the note popover instead of the delete bubble. */
  hasNote: boolean;
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
  note: string | null;
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
    note: row.note ?? null,
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
        chapter_title, section_index, color, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, range_cfi) DO NOTHING;`,
      highlight.bookId,
      highlight.text,
      highlight.startCfi,
      highlight.endCfi,
      highlight.rangeCfi,
      highlight.chapterTitle,
      highlight.sectionIndex,
      highlight.color,
      highlight.note,
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
    const rows = await database.getAllAsync<{ range_cfi: string; section_index: number; has_note: number }>(
      `SELECT range_cfi, section_index, (note IS NOT NULL AND note != '') AS has_note
       FROM reader_highlights
       WHERE book_id = ?
       ORDER BY section_index ASC, id ASC;`,
      bookId,
    );
    return rows.map((row) => ({
      rangeCfi: row.range_cfi,
      sectionIndex: row.section_index,
      hasNote: row.has_note === 1,
    }));
  },

  /** Set (or clear with null/empty) the note attached to a highlight. */
  async updateHighlightNote(bookId: string, rangeCfi: string, note: string | null) {
    const database = await getLibraryDatabase();
    const trimmed = note?.trim() ? note.trim() : null;
    const now = new Date().toISOString();
    await database.runAsync(
      `UPDATE reader_highlights
       SET note = ?, updated_at = ?
       WHERE book_id = ? AND range_cfi = ?;`,
      trimmed,
      now,
      bookId,
      rangeCfi,
    );
    return trimmed;
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
