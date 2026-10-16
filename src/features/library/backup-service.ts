import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { writeBackupArchive, type BackupSource, type BackupWriteOptions } from './backup-writer';
import { invalidateReaderData } from '../reader/reader-preload';
import { BACKUP_LIMITS, extractZipEntry, readZipDirectory, type ZipSource } from '../../shared/epub/zip';
import { hashEpub } from '../../shared/epub/hash';

import {
  DATABASE_NAME,
  SCHEMA_VERSION,
  getLibraryDatabase,
  migrateLibraryDatabase,
} from './library-database';
import {
  BACKUP_FORMAT_VERSION,
  BackupImportError,
  assertManifestMatchesDatabase,
  parseBackupManifest,
  type BackupBookEntry,
  type BackupManifest,
} from './backup-validation';

export { BackupImportError } from './backup-validation';
export type { BackupBookEntry, BackupManifest, ImportBackupErrorCode } from './backup-validation';

export type ExportBackupResult = { uri: string; fileName: string; bookCount: number };
export type ImportBackupResult = { bookCount: number };

function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `reader-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.zip`
  );
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
export async function exportBackup(now = new Date(), options: BackupWriteOptions = {}): Promise<ExportBackupResult> {
  const database = await getLibraryDatabase();
  const snapshot = await database.serializeAsync();
  const snapshotDatabase = await SQLite.deserializeDatabaseAsync(snapshot);
  let books: Array<{
    id: string;
    file_uri: string;
    cover_uri: string | null;
    original_cover_uri: string | null;
    file_hash: string;
    archived_at: string | null;
  }>;
  try {
    books = await snapshotDatabase.getAllAsync<{
      id: string; file_uri: string; cover_uri: string | null;
      original_cover_uri: string | null; file_hash: string; archived_at: string | null;
    }>('SELECT id, file_uri, cover_uri, original_cover_uri, file_hash, archived_at FROM books ORDER BY manual_order ASC;');
  } finally {
    await snapshotDatabase.closeAsync();
  }

  const sources: BackupSource[] = [];

  // SQLite's own snapshot includes committed WAL pages without reading a
  // live database file while another connection may still be writing it.
  sources.push({ name: DATABASE_NAME, data: snapshot });

  // 2. Book files + covers, keyed by book id. Import replaces the whole
  //    database, ids included, so the keys stay valid on the new device.
  const manifestBooks: BackupBookEntry[] = [];
  for (const book of books) {
    let hasFile = false;
    try {
      const source = new File(book.file_uri);
      if (!book.archived_at && source.exists) {
        // EPUBs are already zipped — STORE is faster and barely larger.
        sources.push({ name: `books/${book.id}.epub`, data: source });
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
          sources.push({ name: `covers/${book.id}.${coverExtension}`, data: coverSource });
          hasCover = true;
        }
      } catch {
        // Same as above: row survives, cover can be regenerated.
      }
    }
    let hasOriginalCover = false;
    let originalCoverExtension: string | null = null;
    if (book.original_cover_uri) {
      try {
        const original = new File(book.original_cover_uri);
        if (original.exists) {
          originalCoverExtension = extensionOf(book.original_cover_uri);
          sources.push({ name: `covers/${book.id}-original.${originalCoverExtension}`, data: original });
          hasOriginalCover = true;
        }
      } catch {
        // Older imports may no longer have the original cover on disk.
      }
    }
    manifestBooks.push({
      id: book.id, fileHash: book.file_hash, hasFile, hasCover, coverExtension,
      hasOriginalCover, originalCoverExtension,
    });
  }

  const manifest: BackupManifest = {
    app: 'reader',
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    schemaVersion: SCHEMA_VERSION,
    books: manifestBooks,
  };
  sources.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) });

  const fileName = backupFileName(now);
  const outFile = new File(Paths.cache, fileName);
  await writeBackupArchive(outFile, sources, options);
  return { uri: outFile.uri, fileName, bookCount: books.length };
}

/**
 * Validate and prepare the entire replacement off to the side. The only
 * visible commit is SQLite's online backup from the prepared in-memory DB
 * into the live connection; a failed validation leaves the old DB and files
 * untouched. Book assets use a unique directory, so they never overwrite
 * the old library before that commit.
 */
export async function importBackup(zipUri: string): Promise<ImportBackupResult> {
  const input = new File(zipUri);
  if (input.size > BACKUP_LIMITS.file) throw new Error('备份文件超过 512 MB。');
  const handle = input.open();
  try {
    return await restoreBackupFromSource({ size: input.size, read: (start, length) => {
      handle.offset = start;
      return handle.readBytes(length);
    } });
  } finally { handle.close(); }
}

async function restoreBackupFromSource(source: ZipSource): Promise<ImportBackupResult> {
  const entries = new Map(readZipDirectory(source, BACKUP_LIMITS).map((entry) => [entry.name, entry]));
  const readEntry = (name: string) => {
    const entry = entries.get(name);
    if (!entry) throw new BackupImportError('incomplete-backup');
    return extractZipEntry(source, entry);
  };
  const manifestFile = entries.get('manifest.json');
  if (!manifestFile) throw new BackupImportError('not-a-reader-backup');
  if (manifestFile.uncompressedSize > 16 * 1024 * 1024) throw new BackupImportError('not-a-reader-backup');
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(new TextDecoder().decode(readEntry('manifest.json')));
  } catch {
    throw new BackupImportError('not-a-reader-backup');
  }
  const manifest = parseBackupManifest(rawManifest, SCHEMA_VERSION);

  const dbEntry = entries.get(DATABASE_NAME);
  if (!dbEntry) throw new BackupImportError('missing-database');
  const dbBytes = readEntry(DATABASE_NAME);

  // SQLite header: magic at 0..15, user_version (big-endian u32) at offset 60.
  if (dbBytes.byteLength < 100) throw new BackupImportError('not-a-database');
  const magic = new TextDecoder().decode(dbBytes.slice(0, 16));
  if (!magic.startsWith('SQLite format 3\0')) throw new BackupImportError('not-a-database');
  const backupUserVersion = new DataView(
    dbBytes.buffer,
    dbBytes.byteOffset,
    dbBytes.byteLength,
  ).getUint32(60);
  if (backupUserVersion > SCHEMA_VERSION) throw new BackupImportError('backup-from-newer-app');
  if (backupUserVersion !== manifest.schemaVersion) throw new BackupImportError('incomplete-backup');

  let candidate: SQLite.SQLiteDatabase;
  try {
    candidate = await SQLite.deserializeDatabaseAsync(dbBytes);
  } catch {
    throw new BackupImportError('not-a-database');
  }
  const restoreRoot = new Directory(
    Paths.document, 'Library', 'Restores',
    `restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
  let committed = false;
  try {
    const integrity = await candidate.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check;');
    if (integrity?.quick_check !== 'ok') throw new BackupImportError('not-a-database');
    const backupRows = await candidate.getAllAsync<{ id: string; file_hash: string }>(
      'SELECT id, file_hash FROM books;',
    );
    assertManifestMatchesDatabase(manifest, backupRows);
    await migrateLibraryDatabase(candidate);
    const foreignKeyErrors = await candidate.getAllAsync('PRAGMA foreign_key_check;');
    if (foreignKeyErrors.length > 0) throw new BackupImportError('not-a-database');

    const booksDir = new Directory(restoreRoot, 'Books');
    const coversDir = new Directory(restoreRoot, 'Covers');
    booksDir.create({ idempotent: true, intermediates: true });
    coversDir.create({ idempotent: true, intermediates: true });

    for (const entry of manifest.books) {
      const bookFile = new File(booksDir, `${entry.id}.epub`);
      if (entry.hasFile) {
        const bytes = readEntry(`books/${entry.id}.epub`);
        if (await hashEpub(bytes) !== entry.fileHash) throw new BackupImportError('incomplete-backup');
        bookFile.write(bytes);
      }
      let coverUri: string | null = null;
      if (entry.hasCover && entry.coverExtension) {
        const coverFile = new File(coversDir, `${entry.id}.${entry.coverExtension}`);
        coverFile.write(readEntry(`covers/${entry.id}.${entry.coverExtension}`));
        coverUri = coverFile.uri;
      }
      let originalCoverUri = coverUri;
      if (entry.hasOriginalCover && entry.originalCoverExtension) {
        const originalFile = new File(coversDir, `${entry.id}-original.${entry.originalCoverExtension}`);
        originalFile.write(readEntry(`covers/${entry.id}-original.${entry.originalCoverExtension}`));
        originalCoverUri = originalFile.uri;
      }
      await candidate.runAsync(
        'UPDATE books SET file_uri = ?, cover_uri = ?, original_cover_uri = ? WHERE id = ?;',
        [bookFile.uri, coverUri, originalCoverUri, entry.id],
      );
    }

    // Capture old managed assets for cleanup only after the DB commit. The
    // new files live at different paths even when book ids are identical.
    const live = await getLibraryDatabase();
    const oldAssets = await live.getAllAsync<{
      file_uri: string; cover_uri: string | null; original_cover_uri: string | null;
    }>('SELECT file_uri, cover_uri, original_cover_uri FROM books;');
    await SQLite.backupDatabaseAsync({ sourceDatabase: candidate, destDatabase: live });
    committed = true;
    invalidateReaderData();

    const managedPrefix = new Directory(Paths.document, 'Library').uri.replace(/\/$/, '') + '/';
    const oldUris = new Set(oldAssets.flatMap((book) => [
      book.file_uri, book.cover_uri, book.original_cover_uri,
    ]).filter((uri): uri is string => Boolean(uri)));
    for (const uri of oldUris) {
      if (!uri.startsWith(managedPrefix) || uri.startsWith(restoreRoot.uri + '/')) continue;
      try {
        const oldFile = new File(uri);
        if (oldFile.exists) oldFile.delete();
      } catch {
        // Cleanup is best-effort; the imported library is already committed.
      }
    }
    return { bookCount: manifest.books.length };
  } catch (error) {
    if (!committed && restoreRoot.exists) {
      try { restoreRoot.delete(); } catch { /* Preserve the original error. */ }
    }
    throw error;
  } finally {
    await candidate.closeAsync().catch(() => undefined);
  }
}
