import type { ExcerptFeedItem } from './excerpt-feed-repository';

function heading(text: string) {
  return text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}\[\]()#+.!<>])/g, '\\$1');
}
function quoted(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}

export function excerptsToMarkdown(items: ExcerptFeedItem[]): string {
  const books = new Map<string, ExcerptFeedItem[]>();
  for (const item of items) {
    const group = books.get(item.bookId) ?? [];
    group.push(item); books.set(item.bookId, group);
  }
  const lines = ['# 阅读摘录', ''];
  for (const group of books.values()) {
    const first = group[0];
    lines.push(`## ${heading(first.bookTitle)}`, '');
    if (first.author) lines.push(`作者：${heading(first.author)}`, '');
    for (const item of group) {
      lines.push(quoted(item.quoteText), '');
      const metadata = [item.chapterTitle ? heading(item.chapterTitle) : null, item.createdAt].filter(Boolean);
      lines.push(metadata.join(' · '), '', '---', '');
    }
  }
  return lines.join('\n');
}
