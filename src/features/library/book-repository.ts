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
  archived_at: string | null;
  tags_json: string | null;
  last_opened_at: string | null;
  reading_status: ReadingStatus;
  progress_percentage: number | null;
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
    archivedAt: row.archived_at,
    tags: row.tags_json ? JSON.parse(row.tags_json) as string[] : [],
    lastOpenedAt: row.last_opened_at,
    readingStatus: row.reading_status,
    readingProgress: row.progress_percentage,
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
  async getAllBooks(includeArchived = false) {
    const database = await getLibraryDatabase();
    const rows = await database.getAllAsync<BookRow>(`
      SELECT books.*, reading_progress.percentage AS progress_percentage,
        (SELECT json_group_array(tag) FROM book_tags WHERE book_id = books.id) AS tags_json
      FROM books
      LEFT JOIN reading_progress ON reading_progress.book_id = books.id
      WHERE (? = 1 OR books.archived_at IS NULL)
      ORDER BY books.manual_order ASC, books.added_at ASC;
    `, includeArchived ? 1 : 0);
    return rows.map(mapRow);
  },

  async getBookById(bookId: string) {
    const database = await getLibraryDatabase();
    const row = await database.getFirstAsync<BookRow>(`
      SELECT books.*, reading_progress.percentage AS progress_percentage,
        (SELECT json_group_array(tag) FROM book_tags WHERE book_id = books.id) AS tags_json
      FROM books
      LEFT JOIN reading_progress ON reading_progress.book_id = books.id
      WHERE books.id = ?;
    `, bookId);
    return row ? mapRow(row) : null;
  },

  async getDuplicate(identifier: string | null, fileHash: string, title: string) {
    const database = await getLibraryDatabase();
    // file_hash match = same file bytes, a strong duplicate signal.
    // identifier match alone is NOT enough: some sources (e.g. Z-Library)
    // stamp the same <dc:identifier> on completely different books, so we
    // also require the title to match (case-insensitive).
    const normalizedTitle = title.trim();
    const row = identifier
      ? await database.getFirstAsync<BookRow>(`
        SELECT books.*, reading_progress.percentage AS progress_percentage,
        (SELECT json_group_array(tag) FROM book_tags WHERE book_id = books.id) AS tags_json
        FROM books LEFT JOIN reading_progress ON reading_progress.book_id = books.id
        WHERE books.file_hash = ?
          OR (books.archived_at IS NULL AND books.identifier = ? AND books.title COLLATE NOCASE = ?)
        ORDER BY (books.file_hash = ?) DESC, (books.archived_at IS NULL) DESC
        LIMIT 1;
      `, fileHash, identifier, normalizedTitle, fileHash)
      : await database.getFirstAsync<BookRow>(`
        SELECT books.*, reading_progress.percentage AS progress_percentage,
        (SELECT json_group_array(tag) FROM book_tags WHERE book_id = books.id) AS tags_json
        FROM books LEFT JOIN reading_progress ON reading_progress.book_id = books.id
        WHERE books.file_hash = ? ORDER BY (books.archived_at IS NULL) DESC LIMIT 1;
      `, fileHash);
    return row ? mapRow(row) : null;
  },

  async insertBook(book: Omit<Book, 'coverTone' | 'hasGeneratedCover'>) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      `INSERT INTO books (
        id, title, author, cover_uri, format, file_uri, file_hash, file_size, identifier, language, publisher,
        added_at, last_opened_at, reading_status, manual_order, original_title, original_author,
        original_cover_uri, metadata_json, toc_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      book.id, book.title, book.author, book.coverUri, book.format, book.fileUri, book.fileHash, book.fileSize,
      book.identifier, book.language, book.publisher,
      book.addedAt, book.lastOpenedAt, book.readingStatus, book.manualOrder,
      book.originalTitle, book.originalAuthor, book.originalCoverUri, book.metadataJson, book.tocJson,
    );
  },

  async updateBookMetadata(bookId: string, metadata: BookMetadataUpdate) {
    const database = await getLibraryDatabase();
    await database.runAsync('UPDATE books SET title = ?, author = ?, cover_uri = ? WHERE id = ?;', metadata.title, metadata.author, metadata.coverUri, bookId);
  },

  async updateBook(book: Pick<Book, 'id' | 'title' | 'author' | 'coverUri' | 'lastOpenedAt' | 'readingStatus'>) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      `UPDATE books
       SET title = ?, author = ?, cover_uri = ?, last_opened_at = ?, reading_status = ?
       WHERE id = ?;`,
      book.title, book.author, book.coverUri, book.lastOpenedAt, book.readingStatus, book.id,
    );
  },

  async restoreOriginalMetadata(bookId: string) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      'UPDATE books SET title = original_title, author = original_author, cover_uri = original_cover_uri WHERE id = ?;',
      bookId,
    );
  },

  async updateReadingStatus(bookId: string, status: ReadingStatus) {
    const database = await getLibraryDatabase();
    await database.runAsync('UPDATE books SET reading_status = ? WHERE id = ?;', status, bookId);
  },

  async recordReading(bookId: string) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      `UPDATE books
       SET last_opened_at = ?,
           reading_status = CASE WHEN reading_status = 'unread' THEN 'reading' ELSE reading_status END
       WHERE id = ?;`,
      new Date().toISOString(),
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

  async restoreBookFile(bookId: string, fileUri: string, coverUri: string | null) {
    const database = await getLibraryDatabase();
    await database.runAsync(
      'UPDATE books SET file_uri = ?, cover_uri = ?, original_cover_uri = ?, archived_at = NULL WHERE id = ?;',
      fileUri, coverUri, coverUri, bookId,
    );
  },

  async updateTags(bookId: string, tags: string[]) {
    const normalized = [...new Set(tags.map((tag) => tag.trim().normalize('NFC')).filter(Boolean))];
    if (normalized.length > 20 || normalized.some((tag) => tag.length > 40)) throw new Error('标签过多或过长。');
    const database = await getLibraryDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM book_tags WHERE book_id = ?;', bookId);
      for (const tag of normalized) {
        await transaction.runAsync('INSERT INTO book_tags (book_id, tag) VALUES (?, ?);', bookId, tag);
      }
    });
  },

  async removeBooks(books: Book[], permanently: boolean) {
    const database = await getLibraryDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      for (const book of books) {
        for (const uri of new Set([book.fileUri, book.coverUri, book.originalCoverUri])) {
          if (uri) await transaction.runAsync('INSERT OR IGNORE INTO library_file_cleanup (uri) VALUES (?);', uri);
        }
        if (permanently) {
          await transaction.runAsync('DELETE FROM books WHERE id = ?;', book.id);
        } else {
          await transaction.runAsync(
            'UPDATE books SET archived_at = ?, cover_uri = NULL, original_cover_uri = NULL WHERE id = ?;',
            new Date().toISOString(), book.id,
          );
        }
      }
    });
  },
};
