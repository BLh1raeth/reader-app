export type ReadingStatus = 'unread' | 'reading' | 'finished';
export type BookFormat = 'epub';
export type CoverTone = 'paper' | 'coral' | 'mist' | 'ink' | 'sage' | 'plum' | 'ocean';

export type Book = {
  id: string;
  title: string;
  author: string | null;
  coverUri: string | null;
  format: BookFormat;
  fileUri: string;
  fileHash: string;
  fileSize: number;
  identifier: string | null;
  language: string | null;
  publisher: string | null;
  addedAt: string;
  lastOpenedAt: string | null;
  readingStatus: ReadingStatus;
  readingProgress: number;
  manualOrder: number;
  originalTitle: string;
  originalAuthor: string | null;
  originalCoverUri: string | null;
  metadataJson: string;
  tocJson: string;
  coverTone: CoverTone;
  hasGeneratedCover: boolean;
};

export type ParsedEpub = {
  title: string | null;
  author: string | null;
  identifier: string | null;
  language: string | null;
  publisher: string | null;
  toc: Array<{ href: string; label: string }>;
  cover: { bytes: Uint8Array; extension: string } | null;
  metadataJson: string;
};

export type BookMetadataUpdate = Pick<Book, 'title' | 'author' | 'coverUri'>;
