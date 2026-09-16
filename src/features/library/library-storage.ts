import { Directory, File, Paths } from 'expo-file-system';

const libraryDirectory = new Directory(Paths.document, 'Library');
const booksDirectory = new Directory(libraryDirectory, 'Books');
const coversDirectory = new Directory(libraryDirectory, 'Covers');
const temporaryDirectory = new Directory(libraryDirectory, 'Temp');

function ensureDirectory(directory: Directory) {
  directory.create({ idempotent: true, intermediates: true });
}

export function ensureLibraryStorage() {
  ensureDirectory(libraryDirectory);
  ensureDirectory(booksDirectory);
  ensureDirectory(coversDirectory);
  ensureDirectory(temporaryDirectory);
}

export function bookFileFor(bookId: string) {
  return new File(booksDirectory, `${bookId}.epub`);
}

export function coverFileFor(bookId: string, extension: string) {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  return new File(coversDirectory, `${bookId}.${safeExtension}`);
}

export async function persistEpub(sourceUri: string, bookId: string) {
  ensureLibraryStorage();
  const destination = bookFileFor(bookId);
  await new File(sourceUri).copy(destination, { overwrite: true });
  return destination.uri;
}

export function persistCoverBytes(bookId: string, bytes: Uint8Array, extension: string) {
  ensureLibraryStorage();
  const destination = coverFileFor(bookId, extension);
  destination.write(bytes);
  return destination.uri;
}

export async function persistCustomCover(sourceUri: string, bookId: string, extension: string) {
  ensureLibraryStorage();
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  const destination = new File(coversDirectory, `${bookId}-custom.${safeExtension}`);
  await new File(sourceUri).copy(destination, { overwrite: true });
  return destination.uri;
}

export function removeManagedFile(uri: string | null) {
  if (!uri) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

export function removeBookFiles(book: { coverUri: string | null; fileUri: string; id: string; originalCoverUri: string | null }) {
  removeManagedFile(book.fileUri);
  removeManagedFile(book.coverUri);
  if (book.coverUri !== book.originalCoverUri) removeManagedFile(book.originalCoverUri);
  if (coversDirectory.exists) {
    for (const entry of coversDirectory.list()) {
      if (entry instanceof File && entry.name.startsWith(`${book.id}-custom.`)) entry.delete();
    }
  }
}

export function fileExtensionFromName(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : 'jpg';
}
