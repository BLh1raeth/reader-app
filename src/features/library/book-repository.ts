import { getLibraryDatabase } from './library-database';
import type { Book, BookMetadataUpdate, ReadingStatus } from './library-types';

type BookRow = {
  id: string;
  title: string;
  author: string | null;
  cover_uri: string | null;
  format: 'epub';
  file_uri: string;
  file_hash: string;
  file_size: number;
  identifier: string | null;
  language: string | null;
  publisher: string | null;
  added_at: string;
  last_opened_at: string | null;
  reading_status: ReadingStatus;
  reading_progress: number;
  manual_order: number;
  original_title: string;
  original_author: string | null;
  original_cover_uri: string | null;
  metadata_json: string;
  toc_json: string;
};

const coverTones = ['paper', 'coral', 'mist', 'ink', 'sage', 'plum', 'ocean'] as const;

function toneForBook(id: string): Book['coverTone'] {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return coverTones[Math.abs(hash) % coverTones.length];
}

function mapRow(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    coverUri: row.cover_uri,
    format: row.format,
    fileUri: row.file_uri,
    fileHash: row.file_hash,
    fileSize: row.file_size,
    identifier: row.identifier,
    language: row.language,
    publisher: row.publisher,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at,
    readingStatus: row.reading_status,
    readingProgress: row.reading_progress,
    manualOrder: row.manual_order,
    originalTitle: row.original_title,
    originalAuthor: row.original_author,
    originalCoverUri: row.original_cover_uri,
    metadataJson: row.metadata_json,
    tocJson: row.toc_json,
    coverTone: toneForBook(row.id),
    hasGeneratedCover: !row.cover_uri,
  };
}

export const bookRepository = {
  async getAllBooks() {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<BookRow>('SELECT * FROM books ORDER BY manual_order ASC, added_at ASC;');
    return rows.map(mapRow);
  },

  async getBookById(bookId: string) {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<BookRow>('SELECT * FROM books WHERE id = ?;', bookId);
    return row ? mapRow(row) : null;
  },

  async getDuplicate(identifier: string | null, fileHash: string) {
    const database = await getLibraryDatabase();
    const row = identifier
      ? await database.getFirstAsync<BookRow>('SELECT * FROM books WHERE identifier = ? OR file_hash = ? LIMIT 1;', identifier, fileHash)
      : await database.getFirstAsync<BookRow>('SELECT * FROM books WHERE file_hash = ? LIMIT 1;', fileHash);
    return row ? mapRow(row) : null;
  },

  async insertBook(book: Omit<Book, 'coverTone' | 'hasGeneratedCover'>) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      `INSERT INTO books (
        id, title, author, cover_uri, format, file_uri, file_hash, file_size, identifier, language, publisher,
        added_at, last_opened_at, reading_status, reading_progress, manual_order, original_title, original_author,
        original_cover_uri, metadata_json, toc_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      book.id, book.title, book.author, book.coverUri, book.format, book.fileUri, book.fileHash, book.fileSize,
      book.identifier, book.language, book.publisher,
      book.addedAt, book.lastOpenedAt, book.readingStatus, book.readingProgress, book.manualOrder,
      book.originalTitle, book.originalAuthor, book.originalCoverUri, book.metadataJson, book.tocJson,
    );
  },

  async updateBookMetadata(bookId: string, metadata: BookMetadataUpdate) {
    const database = await getLibraryDatabase();
    await database.runAsync('UPDATE books SET title = ?, author = ?, cover_uri = ? WHERE id = ?;', metadata.title, metadata.author, metadata.coverUri, bookId);
  },

  async updateBook(book: Pick<Book, 'id' | 'title' | 'author' | 'coverUri' | 'lastOpenedAt' | 'readingProgress' | 'readingStatus'>) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      `UPDATE books
       SET title = ?, author = ?, cover_uri = ?, last_opened_at = ?, reading_progress = ?, reading_status = ?
       WHERE id = ?;`,
      book.title, book.author, book.coverUri, book.lastOpenedAt, book.readingProgress, book.readingStatus, book.id,
    );
  },

  async restoreOriginalMetadata(bookId: string) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      'UPDATE books SET title = original_title, author = original_author, cover_uri = original_cover_uri WHERE id = ?;',
      bookId,
    );
  },

  async updateReadingStatus(bookId: string, status: ReadingStatus, progress: number) {
    const database = await getLibraryDatabase();
    await database.runAsync('UPDATE books SET reading_status = ?, reading_progress = ? WHERE id = ?;', status, progress, bookId);
  },

  async recordReading(bookId: string, progress: number) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      `UPDATE books
       SET last_opened_at = ?,
           reading_progress = ?,
           reading_status = CASE WHEN reading_status = 'unread' THEN 'reading' ELSE reading_status END
       WHERE id = ?;`,
      new Date().toISOString(),
      progress,
      bookId,
    );
  },

  async updateManualOrder(bookIds: string[]) {
    const database = await getLibraryDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      for (const [index, bookId] of bookIds.entries()) {
        await transaction.runAsync('UPDATE books SET manual_order = ? WHERE id = ?;', index, bookId);
      }
    });
  },

  async deleteBook(bookId: string) {
    const database = await getLibraryDatabase();
    await database.runAsync('DELETE FROM books WHERE id = ?;', bookId);
  },
};
