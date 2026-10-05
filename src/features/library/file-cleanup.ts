import { Directory, File, Paths } from 'expo-file-system';
import { getLibraryDatabase } from './library-database';

/** DB commits own the intent; failed filesystem cleanup can be retried later. */
let cleanupPromise: Promise<void> | null = null;
export function retryFileCleanup(): Promise<void> {
  if (!cleanupPromise) {
    cleanupPromise = processFileCleanup().finally(() => { cleanupPromise = null; });
  }
  return cleanupPromise;
}

async function processFileCleanup() {
  const database = await getLibraryDatabase();
  const pending = await database.getAllAsync<{ uri: string }>('SELECT uri FROM library_file_cleanup;');
  const prefix = new Directory(Paths.document, 'Library').uri.replace(/\/$/, '') + '/';
  for (const { uri } of pending) {
    try {
      // Restored databases may carry old device paths. Never delete outside
      // our managed directory, or a file currently referenced by a book.
      const referenced = await database.getFirstAsync<{ n: number }>(
        `SELECT count(*) AS n FROM books WHERE archived_at IS NULL
         AND (file_uri = ? OR cover_uri = ? OR original_cover_uri = ?);`, uri, uri, uri,
      );
      if (uri.startsWith(prefix) && !referenced?.n) {
        const file = new File(uri);
        if (file.exists) file.delete();
      }
      await database.runAsync('DELETE FROM library_file_cleanup WHERE uri = ?;', uri);
    } catch (error) {
      if (__DEV__) console.warn('[LIBRARY_FILE_CLEANUP_FAILED]', String(error));
      // Keep the job for the next library reload.
    }
  }
}
