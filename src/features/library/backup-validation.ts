/** Validation shared by the importer and its Node regression tests. */
export const BACKUP_FORMAT_VERSION = 1;

export type BackupBookEntry = {
  id: string;
  fileHash: string;
  hasFile: boolean;
  hasCover: boolean;
  coverExtension: string | null;
  /** Added without changing the compatible v1 archive layout. */
  hasOriginalCover?: boolean;
  originalCoverExtension?: string | null;
};

export type BackupManifest = {
  app: 'reader';
  backupFormatVersion: number;
  exportedAt: string;
  schemaVersion: number;
  books: BackupBookEntry[];
};

export type ImportBackupErrorCode =
  | 'not-a-reader-backup'
  | 'unsupported-backup'
  | 'missing-database'
  | 'not-a-database'
  | 'backup-from-newer-app'
  | 'incomplete-backup';

export class BackupImportError extends Error {
  readonly code: ImportBackupErrorCode;
  constructor(code: ImportBackupErrorCode) {
    super(code);
    this.code = code;
  }
}

const SAFE_BOOK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_EXTENSION = /^[a-z0-9]{2,5}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function parseBackupManifest(value: unknown, supportedSchemaVersion: number): BackupManifest {
  if (!value || typeof value !== 'object') throw new BackupImportError('not-a-reader-backup');
  const record = value as Record<string, unknown>;
  if (record.app !== 'reader') throw new BackupImportError('not-a-reader-backup');
  if (record.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupImportError('unsupported-backup');
  }
  if (!Number.isInteger(record.schemaVersion) || (record.schemaVersion as number) < 1) {
    throw new BackupImportError('not-a-reader-backup');
  }
  if ((record.schemaVersion as number) > supportedSchemaVersion) {
    throw new BackupImportError('backup-from-newer-app');
  }
  if (typeof record.exportedAt !== 'string' || !Array.isArray(record.books)) {
    throw new BackupImportError('not-a-reader-backup');
  }
  const seen = new Set<string>();
  for (const item of record.books) {
    if (!item || typeof item !== 'object') throw new BackupImportError('not-a-reader-backup');
    const book = item as Record<string, unknown>;
    if (typeof book.id !== 'string' || !SAFE_BOOK_ID.test(book.id) || seen.has(book.id)
      || typeof book.fileHash !== 'string' || !SHA256.test(book.fileHash)
      || typeof book.hasFile !== 'boolean' || typeof book.hasCover !== 'boolean'
      || (book.hasCover && (typeof book.coverExtension !== 'string' || !SAFE_EXTENSION.test(book.coverExtension)))
      || (!book.hasCover && book.coverExtension !== null)
      || (book.hasOriginalCover !== undefined && typeof book.hasOriginalCover !== 'boolean')
      || (book.hasOriginalCover === true
        && (typeof book.originalCoverExtension !== 'string' || !SAFE_EXTENSION.test(book.originalCoverExtension)))
      || (book.hasOriginalCover === false && book.originalCoverExtension != null)) {
      throw new BackupImportError('not-a-reader-backup');
    }
    seen.add(book.id);
  }
  return value as BackupManifest;
}

/** Reject an unrelated but otherwise valid SQLite file before replacing data. */
export function assertManifestMatchesDatabase(
  manifest: BackupManifest,
  rows: Array<{ id: string; file_hash: string }>,
): void {
  if (rows.length !== manifest.books.length) throw new BackupImportError('incomplete-backup');
  const databaseBooks = new Map(rows.map((row) => [row.id, row.file_hash]));
  for (const book of manifest.books) {
    if (databaseBooks.get(book.id) !== book.fileHash) {
      throw new BackupImportError('incomplete-backup');
    }
  }
}
