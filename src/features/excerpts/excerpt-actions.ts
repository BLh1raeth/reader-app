import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Alert, Share } from 'react-native';
import { excerptRepository } from '../reader/excerpt-repository';
import { reportOperationError } from '../../shared/operation-errors';
import { refreshExcerptFeed } from './excerpt-feed-cache';
import { excerptsToMarkdown } from './excerpt-export';
import type { ExcerptFeedItem } from './excerpt-feed-repository';

function excerptRowId(item: ExcerptFeedItem) {
  return Number(item.id.replace(/^excerpt-/, ''));
}

function excerptSource(item: ExcerptFeedItem) {
  return `《${item.bookTitle}》${item.chapterTitle ? ` · ${item.chapterTitle}` : ''}`;
}

export function copyExcerpt(item: ExcerptFeedItem) {
  void Clipboard.setStringAsync(`${item.quoteText}\n\n${excerptSource(item)}`)
    .catch((error) => reportOperationError(error, '复制失败'));
}

export function shareExcerpt(item: ExcerptFeedItem) {
  void Share.share({ message: `${item.quoteText}\n\n${excerptSource(item)}` })
    .catch((error) => reportOperationError(error, '分享失败'));
}

export function editExcerpt(item: ExcerptFeedItem) {
  Alert.prompt('编辑摘录', '只修改这条摘录，不修改书内原文。', (text) => {
    void excerptRepository.updateExcerptText(excerptRowId(item), text).then(refreshExcerptFeed)
      .catch((error) => reportOperationError(error, '编辑失败', '修改尚未保存。内容不能为空，请重试。'));
  }, 'plain-text', item.quoteText);
}

export function deleteExcerpt(item: ExcerptFeedItem) {
  Alert.alert('删除这条摘录？', '书内原文和高亮会保留。', [
    { text: '取消', style: 'cancel' },
    { text: '删除', style: 'destructive', onPress: () => {
      void excerptRepository.deleteExcerpt(excerptRowId(item)).then(refreshExcerptFeed)
        .catch((error) => reportOperationError(error, '删除摘录失败'));
    } },
  ]);
}

export function showExcerptActions(item: ExcerptFeedItem) {
  Alert.alert('摘录', undefined, [
    { text: '取消', style: 'cancel' },
    { text: '复制', onPress: () => copyExcerpt(item) },
    { text: '分享', onPress: () => shareExcerpt(item) },
    { text: '编辑内容', onPress: () => editExcerpt(item) },
    { text: '删除', style: 'destructive', onPress: () => deleteExcerpt(item) },
  ]);
}

export async function exportExcerpts(items: ExcerptFeedItem[]) {
  if (!items.length) { Alert.alert('暂无可导出的摘录'); return; }
  let file: File | null = null;
  try {
    file = new File(Paths.cache, `reader-excerpts-${Date.now()}.md`);
    file.write(excerptsToMarkdown(items));
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'text/markdown', UTI: 'net.daringfireball.markdown', dialogTitle: '导出摘录' });
    } else {
      await Share.share({ message: excerptsToMarkdown(items) });
    }
  } catch (error) { reportOperationError(error, '导出摘录失败'); }
  finally { try { if (file?.exists) file.delete(); } catch { /* Cache may already be gone. */ } }
}
