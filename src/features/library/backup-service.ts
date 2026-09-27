import JSZip from 'jszip';
import { Directory, File, Paths } from 'expo-file-system';

import {
  DATABASE_NAME,
  SCHEMA_VERSION,
  closeLibraryDatabase,
  getLibraryDatabase,
} from './library-database';

/**
 * Backup format version. Bump when the zip layout changes incompatibly;
 * import refuses backups whose version it doesn't understand.
 */
const BACKUP_FORMAT_VERSION = 1;

export type BackupBookEntry = {
  id: string;
  fileHash: string;
  /** EPUB was present on disk and packed into the zip. */
  hasFile: boolean;
  /** Cover image was present on disk and packed into the zip. */
  hasCover: boolean;
  /** Extension of the packed cover file (e.g. "jpg"), null when no cover. */
  coverExtension: string | null;
};

export type BackupManifest = {
  app: 'reader';
  backupFormatVersion: number;
  exportedAt: string;
  schemaVersion: number;
  books: BackupBookEntry[];
};

export type ExportBackupResult = { uri: string; fileName: string; bookCount: number };
export type ImportBackupResult = { bookCount: number };

/** Machine-readable import failures; the UI maps these to Chinese copy. */
export type ImportBackupErrorCode =
  | 'not-a-reader-backup'
  | 'unsupported-backup'
  | 'missing-database'
  | 'not-a-database'
  | 'backup-from-newer-app';

export class BackupImportError extends Error {
  readonly code: ImportBackupErrorCode;
  constructor(code: ImportBackupErrorCode) {
    super(code);
    this.code = code;
  }
}

function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `reader-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.zip`
  );
}

/** Matches expo-sqlite's iOS default location: <Documents>/SQLite/<name>. */
function databaseFile(): File {
  return new File(Paths.document, 'SQLite', DATABASE_NAME);
}

function booksDirectory(): Directory {
  return new Directory(Paths.document, 'Library', 'Books');
}

function coversDirectory(): Directory {
  return new Directory(Paths.document, 'Library', 'Covers');
}

function extensionOf(uri: string): string {
  const base = uri.split('/').pop() ?? '';
  const ext = base.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'jpg';
}

/**
 * Pack the whole library (database + EPUBs + covers + manifest) into a
 * single zip and return its file URI for sharing. Pure JS, no native work.
 */
export async function exportBackup(now = new Date()): Promise<ExportBackupResult> {
  const database = await getLibraryDatabase();
  // Merge any WAL content into the main file so the copy is complete.
  await database.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');

  const books = await database.getAllAsync<{
    id: string;
    file_uri: string;
    cover_uri: string | null;
    file_hash: string;
  }>('SELECT id, file_uri, cover_uri, file_hash FROM books ORDER BY manual_order ASC;');

  const zip = new JSZip();

  // 1. The database — every table (books, progress, highlights, excerpts,
  //    analytics, goals) lives in this one file.
  zip.file(DATABASE_NAME, await databaseFile().arrayBuffer());

  // 2. Book files + covers, keyed by book id. Import replaces the whole
  //    database, ids included, so the keys stay valid on the new device.
  const manifestBooks: BackupBookEntry[] = [];
  for (const book of books) {
    let hasFile = false;
    try {
      const source = new File(book.file_uri);
      if (source.exists) {
        // EPUBs are already zipped — STORE is faster and barely larger.
        zip.file(`books/${book.id}.epub`, await source.arrayBuffer());
        hasFile = true;
      }
    } catch {
      // Missing file: the row is still backed up; the book re-links if the
      // user re-imports the same file later (matched by file_hash).
    }
    let hasCover = false;
    let coverExtension: string | null = null;
    if (book.cover_uri) {
      try {
        const coverSource = new File(book.cover_uri);
        if (coverSource.exists) {
          coverExtension = extensionOf(book.cover_uri);
          zip.file(`covers/${book.id}.${coverExtension}`, await coverSource.arrayBuffer());
          hasCover = true;
        }
      } catch {
        // Same as above: row survives, cover can be regenerated.
      }
    }
    manifestBooks.push({ id: book.id, fileHash: book.file_hash, hasFile, hasCover, coverExtension });
  }

  const manifest: BackupManifest = {
    app: 'reader',
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    schemaVersion: SCHEMA_VERSION,
    books: manifestBooks,
  };
  zip.file('manifest.json', JSON.stringify(manifest));

  const fileName = backupFileName(now);
  const outFile = new File(Paths.cache, fileName);
  outFile.write(await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
  return { uri: outFile.uri, fileName, bookCount: books.length };
}

/**
 * Restore a backup zip, replacing ALL current library data. Steps:
 * validate -> close live DB -> delete stale WAL companions -> write the new
 * database file -> re-open (migrations run automatically for older backups)
 * -> extract books/covers to canonical locations -> rewrite stored URIs to
 * the new sandbox paths.
 */
export async function importBackup(zipUri: string): Promise<ImportBackupResult> {
  const zip = await JSZip.loadAsync(await new File(zipUri).arrayBuffer());

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new BackupImportError('not-a-reader-backup');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await manifestFile.async('string')) as BackupManifest;
  } catch {
    throw new BackupImportError('not-a-reader-backup');
  }
  if (manifest.app !== 'reader' || manifest.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupImportError('unsupported-backup');
  }

  const dbEntry = zip.file(DATABASE_NAME);
  if (!dbEntry) throw new BackupImportError('missing-database');
  const dbBytes = await dbEntry.async('uint8array');

  // SQLite header: magic at 0..15, user_version (big-endian u32) at offset 60.
  const magic = new TextDecoder().decode(dbBytes.slice(0, 16));
  if (!magic.startsWith('SQLite format 3\0')) throw new BackupImportError('not-a-database');
  const backupUserVersion = new DataView(
    dbBytes.buffer,
    dbBytes.byteOffset,
    dbBytes.byteLength,
  ).getUint32(60);
  if (backupUserVersion > SCHEMA_VERSION) throw new BackupImportError('backup-from-newer-app');

  // Swap the database file. Stale WAL/-shm companions from the old database
  // must go first, or SQLite would try to apply them to the new file.
  const dbFile = databaseFile();
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const companion = new File(`${dbFile.uri}${suffix}`);
    if (companion.exists) companion.delete();
  }
  await closeLibraryDatabase();
  dbFile.write(dbBytes);

  // Restore files to canonical locations, then point the (new) database rows
  // at this device's sandbox paths — the old phone's paths are meaningless.
  const booksDir = booksDirectory();
  const coversDir = coversDirectory();
  booksDir.create({ idempotent: true, intermediates: true });
  coversDir.create({ idempotent: true, intermediates: true });

  const database = await getLibraryDatabase();
  for (const entry of manifest.books) {
    let fileUri: string | null = null;
    if (entry.hasFile) {
      const epubEntry = zip.file(`books/${entry.id}.epub`);
      if (epubEntry) {
        const dest = new File(booksDir, `${entry.id}.epub`);
        dest.write(await epubEntry.async('uint8array'));
        fileUri = dest.uri;
      }
    }
    let coverUri: string | null = null;
    if (entry.hasCover && entry.coverExtension) {
      const coverEntry = zip.file(`covers/${entry.id}.${entry.coverExtension}`);
      if (coverEntry) {
        const dest = new File(coversDir, `${entry.id}.${entry.coverExtension}`);
        dest.write(await coverEntry.async('uint8array'));
        coverUri = dest.uri;
      }
    }
    // Canonical locations even when the file was missing from the backup —
    // the row is restored either way; a missing file is a missing file.
    const finalFileUri = fileUri ?? new File(booksDir, `${entry.id}.epub`).uri;
    await database.runAsync('UPDATE books SET file_uri = ?, cover_uri = ? WHERE id = ?;', [
      finalFileUri,
      coverUri,
      entry.id,
    ]);
  }

  return { bookCount: manifest.books.length };
}
