import { Easing, LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { tokens } from '../../../design-system/tokens';
import type { Book, ReadingStatus } from '../library-types';

export const LIBRARY_HEADER_SAFE_TOP_GAP = 2;
// 书库 tab 左右边距：与摘录 tab 的 20pt 对齐（不再用 tokens.spacing.screen=28）。
export const LIBRARY_SCREEN_MARGIN = 20;

export type SortMode = 'manual' | 'recentlyRead' | 'recentlyAdded' | 'title' | 'author';
export type FilterMode = 'all' | ReadingStatus;
export type LibraryBook = Book & { lastReadAt?: string; progress: number | null; state: ReadingStatus };
export type BookMenuHandlers = {
  onEditCover: (book: LibraryBook) => void;
  onEditTitle: (book: LibraryBook) => void;
  onEditAuthor: (book: LibraryBook) => void;
  onRestoreOriginal: (book: LibraryBook) => void;
  onRemove: () => void;
  onShare: (book: LibraryBook) => void;
  onToggleFinished: (book: LibraryBook) => void;
};

export type ReaderOpeningFrame = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type ReaderOpeningTransition = {
  backgroundColor: string;
  book: LibraryBook;
  frame: ReaderOpeningFrame;
  id: number;
  target: ReaderOpeningFrame;
};

export const layoutTransition = LinearTransition.duration(tokens.animation.layoutDuration).reduceMotion(
  ReduceMotion.System,
);
export const reorderLayoutTransition = LinearTransition.duration(300)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
export const displayModeTransition = LinearTransition.duration(340)
  .easing(Easing.inOut(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
export const selectionTransitionDuration = 280;

export const sortLabels: Record<SortMode, string> = {
  manual: '手动',
  recentlyRead: '最近阅读',
  recentlyAdded: '最近添加',
  title: '书名',
  author: '作者',
};

export const filterLabels: Record<FilterMode, string> = {
  all: '全部',
  reading: '阅读中',
  unread: '未开始',
  finished: '已读完',
};

export function toLibraryBook(book: Book): LibraryBook {
  return { ...book, lastReadAt: book.lastOpenedAt ?? undefined, progress: book.readingProgress, state: book.readingStatus };
}

export function displayProgress(book: LibraryBook) {
  return book.progress === null ? null : Math.round(book.progress * 100);
}

export const IMPORT_RING_RADIUS = 19;
export const IMPORT_RING_CIRCUMFERENCE = 2 * Math.PI * IMPORT_RING_RADIUS;

export function readingStateLabel(book: LibraryBook) {
  if (book.state === 'finished') return '已读完';
  if (book.progress === null) return '未开始';
  return `${displayProgress(book)}%`;
}
