import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';

import { bookRepository } from './book-repository';
import { parseEpub } from './epub-parser';
import { fileExtensionFromName, persistCoverBytes, persistCustomCover, persistEpub, removeBookFiles, removeManagedFile } from './library-storage';
import type { Book, BookMetadataUpdate, ParsedEpub, ReadingStatus } from './library-types';

export type ImportFailure = { name: string; reason: string };
export type DuplicateImport = { asset: DocumentPicker.DocumentPickerAsset; existingBook: Book };
export type ImportSummary = { duplicates: DuplicateImport[]; failures: ImportFailure[]; imported: Book[] };

function sha256(bytes: Uint8Array) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const words: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) words[index >> 2] = (words[index >> 2] ?? 0) | (bytes[index] << (24 - (index % 4) * 8));
  words[bytes.length >> 2] = (words[bytes.length >> 2] ?? 0) | (0x80 << (24 - (bytes.length % 4) * 8));
  const bitLength = bytes.length * 8;
  const lastIndex = (((bytes.length + 9 + 63) >> 6) << 4) - 1;
  words[lastIndex - 1] = Math.floor(bitLength / 0x100000000);
  words[lastIndex] = bitLength >>> 0;
  let hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotateRight = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < words.length; offset += 16) {
    const schedule = new Array<number>(64);
    for (let index = 0; index < 64; index += 1) {
      if (index < 16) schedule[index] = words[offset + index] ?? 0;
      else {
        const s0 = rotateRight(schedule[index - 15], 7) ^ rotateRight(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3);
        const s1 = rotateRight(schedule[index - 2], 17) ^ rotateRight(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10);
        schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) | 0;
      }
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choose + constants[index] + schedule[index]) | 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    hash = hash.map((value, index) => (value + [a, b, c, d, e, f, g, h][index]) | 0);
  }
  return hash.map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

function newBookId(fileHash: string) {
  return `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${fileHash.slice(0, 8)}`;
}

function titleFromFilename(name: string) {
  const stripped = name.replace(/\.epub$/i, '').trim();
  return stripped || '未命名图书';
}

function isEpub(asset: DocumentPicker.DocumentPickerAsset) {
  return /\.epub$/i.test(asset.name) || asset.mimeType === 'application/epub+zip';
}

type PreparedImport = { asset: DocumentPicker.DocumentPickerAsset; bytes: Uint8Array; fileHash: string; parsed: ParsedEpub };

async function prepareImport(asset: DocumentPicker.DocumentPickerAsset): Promise<PreparedImport> {
  if (!isEpub(asset)) throw new Error('只支持 EPUB 图书。');
  const bytes = await new File(asset.uri).bytes();
  if (bytes.length === 0) throw new Error('文件为空。');
  return { asset, bytes, fileHash: sha256(bytes), parsed: parseEpub(bytes) };
}

async function writePreparedImport(
  prepared: PreparedImport,
  forceDuplicate: boolean,
): Promise<{ duplicate: Book } | { book: Book }> {
  const duplicate = await bookRepository.getDuplicate(prepared.parsed.identifier, prepared.fileHash);
  if (duplicate !== null && !forceDuplicate) return { duplicate };

  const allBooks = await bookRepository.getAllBooks();
  const id = newBookId(prepared.fileHash);
  let fileUri: string | null = null;
  let coverUri: string | null = null;
  try {
    fileUri = await persistEpub(prepared.asset.uri, id);
    coverUri = prepared.parsed.cover
      ? persistCoverBytes(id, prepared.parsed.cover.bytes, prepared.parsed.cover.extension)
      : null;
    const title = prepared.parsed.title ?? titleFromFilename(prepared.asset.name);
    const now = new Date().toISOString();
    const book: Omit<Book, 'coverTone' | 'hasGeneratedCover'> = {
      id,
      title,
      author: prepared.parsed.author,
      coverUri,
      format: 'epub',
      fileUri,
      fileHash: prepared.fileHash,
      fileSize: prepared.bytes.length,
      identifier: prepared.parsed.identifier,
      language: prepared.parsed.language,
      publisher: prepared.parsed.publisher,
      addedAt: now,
      lastOpenedAt: null,
      readingStatus: 'unread',
      readingProgress: null,
      manualOrder: allBooks.length,
      originalTitle: title,
      originalAuthor: prepared.parsed.author,
      originalCoverUri: coverUri,
      metadataJson: prepared.parsed.metadataJson,
      tocJson: JSON.stringify(prepared.parsed.toc),
    };
    await bookRepository.insertBook(book);
    return { book: (await bookRepository.getBookById(id))! };
  } catch (error) {
    if (fileUri) removeBookFiles({ coverUri, fileUri, id, originalCoverUri: coverUri });
    throw error;
  }
}

export async function importPickedEpubs(onDuplicate: (duplicate: DuplicateImport) => Promise<boolean>): Promise<ImportSummary | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: ['application/epub+zip', 'application/zip'],
  });
  if (picked.canceled) return null;

  const summary: ImportSummary = { duplicates: [], failures: [], imported: [] };
  for (const asset of picked.assets) {
    try {
      const prepared = await prepareImport(asset);
      let result = await writePreparedImport(prepared, false);
      if ('duplicate' in result) {
        const duplicate = { asset, existingBook: result.duplicate };
        summary.duplicates.push(duplicate);
        if (await onDuplicate(duplicate)) result = await writePreparedImport(prepared, true);
      }
      if ('book' in result) summary.imported.push(result.book);
    } catch (error) {
      summary.failures.push({ name: asset.name, reason: error instanceof Error ? error.message : '无法读取该文件。' });
    }
  }
  if (summary.imported.length > 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  return summary;
}

export async function removeBook(bookId: string) {
  const book = await bookRepository.getBookById(bookId);
  if (!book) return;
  removeBookFiles(book);
  await bookRepository.deleteBook(bookId);
}

export async function removeBooks(bookIds: string[]) {
  for (const bookId of bookIds) await removeBook(bookId);
}

export async function updateBookMetadata(bookId: string, update: BookMetadataUpdate) {
  await bookRepository.updateBookMetadata(bookId, update);
}

export async function restoreOriginalBookMetadata(bookId: string) {
  const book = await bookRepository.getBookById(bookId);
  await bookRepository.restoreOriginalMetadata(bookId);
  if (book?.coverUri && book.coverUri !== book.originalCoverUri) removeManagedFile(book.coverUri);
}

export async function replaceBookCover(book: Book) {
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: 'image/*' });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  const nextCoverUri = await persistCustomCover(asset.uri, book.id, fileExtensionFromName(asset.name));
  await bookRepository.updateBookMetadata(book.id, { title: book.title, author: book.author, coverUri: nextCoverUri });
  if (book.coverUri && book.coverUri !== book.originalCoverUri && book.coverUri !== nextCoverUri) removeManagedFile(book.coverUri);
  return nextCoverUri;
}

export async function shareBook(book: Book) {
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(book.fileUri);
}

export async function updateBookReadingStatus(book: Book, status: ReadingStatus) {
  await bookRepository.updateReadingStatus(book.id, status);
}
