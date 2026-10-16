import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';

import { bookRepository } from './book-repository';
import { retryFileCleanup } from './file-cleanup';
import { invalidateReaderData } from '../reader/reader-preload';
import { parseEpub } from './epub-parser';
import { hashEpub } from '../../shared/epub/hash';
import { EPUB_LIMITS } from '../../shared/epub/zip';
import { fileExtensionFromName, persistCoverBytes, persistCustomCover, persistEpub, removeBookFiles, removeManagedFile } from './library-storage';
import type { Book, BookMetadataUpdate, ParsedEpub, ReadingStatus } from './library-types';

export type ImportFailure = { name: string; reason: string };
export type DuplicateImport = { asset: DocumentPicker.DocumentPickerAsset; existingBook: Book };
export type ImportSummary = { duplicates: DuplicateImport[]; failures: ImportFailure[]; imported: Book[] };

/** Per-file import progress. `fraction` is 0..1 across all picked files. */
export type ImportProgress = {
  fileIndex: number;
  totalFiles: number;
  /** Completed stages for the current file (1..IMPORT_STAGE_COUNT). */
  stage: number;
  totalStages: number;
  fraction: number;
};

/**
 * Import stages per file: read bytes → SHA-256 → parse EPUB → persist files
 * → DB insert. The duplicate-confirm dialog pauses between stages 3 and 4;
 * progress simply doesn't advance while it's up.
 */
const IMPORT_STAGE_COUNT = 5;

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

async function prepareImport(
  asset: DocumentPicker.DocumentPickerAsset,
  onStage: (stage: number) => void,
): Promise<PreparedImport> {
  if (!isEpub(asset)) throw new Error('只支持 EPUB 图书。');
  const file = new File(asset.uri);
  if (file.size > EPUB_LIMITS.file) throw new Error('EPUB 文件超过 256 MB，请使用较小的文件。');
  const bytes = await file.bytes();
  if (bytes.length === 0) throw new Error('文件为空。');
  onStage(1);
  const fileHash = await hashEpub(bytes);
  onStage(2);
  const parsed = parseEpub(bytes);
  onStage(3);
  return { asset, bytes, fileHash, parsed };
}

async function writePreparedImport(
  prepared: PreparedImport,
  forceDuplicate: boolean,
  onStage: (stage: number) => void,
): Promise<{ duplicate: Book } | { book: Book }> {
  const title = prepared.parsed.title ?? titleFromFilename(prepared.asset.name);
  const duplicate = await bookRepository.getDuplicate(prepared.parsed.identifier, prepared.fileHash, title);
  const restoring = duplicate !== null && duplicate.fileHash === prepared.fileHash
    && (Boolean(duplicate.archivedAt) || !new File(duplicate.fileUri).exists);
  if (duplicate !== null && !restoring && !forceDuplicate) return { duplicate };

  const allBooks = await bookRepository.getAllBooks();
  const id = restoring ? duplicate.id : newBookId(prepared.fileHash);
  // A retrying cleanup job may still own an archived file's old path. Write
  // the restored assets at fresh paths before atomically reactivating its id.
  const assetId = restoring ? `${id}-restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : id;
  let fileUri: string | null = null;
  let coverUri: string | null = null;
  let committed = false;
  try {
    fileUri = await persistEpub(prepared.asset.uri, assetId);
    coverUri = prepared.parsed.cover
      ? persistCoverBytes(assetId, prepared.parsed.cover.bytes, prepared.parsed.cover.extension)
      : null;
    onStage(4);
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
    if (restoring) {
      await bookRepository.restoreBookFile(id, fileUri, coverUri);
      invalidateReaderData();
    }
    else await bookRepository.insertBook(book);
    committed = true;
    onStage(5);
    const persisted = await bookRepository.getBookById(id);
    if (!persisted) throw new Error('图书保存后无法重新读取，请刷新书库。');
    return { book: persisted };
  } catch (error) {
    if (fileUri && !committed) {
      try { removeBookFiles({ coverUri, fileUri, id: assetId, originalCoverUri: coverUri }); }
      catch (cleanupError) { if (__DEV__) console.warn('[IMPORT_ROLLBACK_CLEANUP_FAILED]', cleanupError); }
    }
    throw error;
  }
}

export async function importPickedEpubs(
  onDuplicate: (duplicate: DuplicateImport) => Promise<boolean>,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportSummary | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: ['application/epub+zip', 'application/zip'],
  });
  if (picked.canceled) return null;

  // The iOS system document picker reports no progress of its own; the ring
  // appears only after files are picked, starting here.
  const totalFiles = picked.assets.length;
  const reportStage = (fileIndex: number, stage: number) => {
    onProgress?.({
      fileIndex,
      totalFiles,
      stage,
      totalStages: IMPORT_STAGE_COUNT,
      fraction: (fileIndex + stage / IMPORT_STAGE_COUNT) / totalFiles,
    });
  };

  const summary: ImportSummary = { duplicates: [], failures: [], imported: [] };
  for (let fileIndex = 0; fileIndex < picked.assets.length; fileIndex += 1) {
    const asset = picked.assets[fileIndex];
    reportStage(fileIndex, 0);
    try {
      const prepared = await prepareImport(asset, (stage) => reportStage(fileIndex, stage));
      let result = await writePreparedImport(prepared, false, (stage) => reportStage(fileIndex, stage));
      if ('duplicate' in result) {
        const duplicate = { asset, existingBook: result.duplicate };
        summary.duplicates.push(duplicate);
        if (await onDuplicate(duplicate)) result = await writePreparedImport(prepared, true, (stage) => reportStage(fileIndex, stage));
      }
      if ('book' in result) summary.imported.push(result.book);
    } catch (error) {
      summary.failures.push({ name: asset.name, reason: error instanceof Error ? error.message : '无法读取该文件。' });
    }
  }
  if (summary.imported.length > 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  return summary;
}

export async function removeBook(bookId: string, permanently = false) {
  await removeBooks([bookId], permanently);
}

export async function removeBooks(bookIds: string[], permanently = false) {
  const books = await Promise.all(bookIds.map((id) => bookRepository.getBookById(id)));
  await bookRepository.removeBooks(books.filter((book): book is Book => book !== null), permanently);
  invalidateReaderData();
  await retryFileCleanup();
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
  // expo-image-picker 是原生模块：旧 EAS build 里没有，会抛错。
  // 动态 import + try/catch：模块缺失（或权限被拒）时回退到文件选择器，
  // 避免旧 build 启动红屏。但用户主动取消图库选择视为放弃，直接返回，
  // 不再弹文件选择器。
  let imageAsset: { uri: string; fileName?: string | null } | null = null;
  let userCanceledImageLibrary = false;
  try {
    const ImagePicker = await import('expo-image-picker');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.granted) {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });
      if (picked.canceled) {
        userCanceledImageLibrary = true;
      } else {
        const asset = picked.assets[0];
        imageAsset = { uri: asset.uri, fileName: asset.fileName };
      }
    }
  } catch {
    imageAsset = null;
  }
  if (!imageAsset && !userCanceledImageLibrary) {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: 'image/*' });
    if (picked.canceled) return null;
    const asset = picked.assets[0];
    imageAsset = { uri: asset.uri, fileName: asset.name };
  }
  if (!imageAsset) return null;
  const nextCoverUri = await persistCustomCover(imageAsset.uri, book.id, fileExtensionFromName(imageAsset.fileName ?? 'cover.jpg'));
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
