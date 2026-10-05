import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Alert, Share } from 'react-native';
import { excerptRepository } from '../reader/excerpt-repository';
import { reportOperationError } from '../../shared/operation-errors';
import { refreshExcerptFeed } from './excerpt-feed-cache';
import { excerptsToMarkdown } from './excerpt-export';
import type { ExcerptFeedItem } from './excerpt-feed-repository';

export function showExcerptActions(item: ExcerptFeedItem) {
  const rowId = Number(item.id.replace(/^excerpt-/, ''));
  const source = `《${item.bookTitle}》${item.chapterTitle ? ` · ${item.chapterTitle}` : ''}`;
  Alert.alert('摘录', undefined, [
    { text: '取消', style: 'cancel' },
    { text: '复制', onPress: () => {
      void Clipboard.setStringAsync(`${item.quoteText}\n\n${source}`)
        .catch((error) => reportOperationError(error, '复制失败'));
    } },
    { text: '分享', onPress: () => {
      void Share.share({ message: `${item.quoteText}\n\n${source}` })
        .catch((error) => reportOperationError(error, '分享失败'));
    } },
    { text: '编辑内容', onPress: () => Alert.prompt('编辑摘录', '只修改这条摘录，不修改书内原文。', (text) => {
      void excerptRepository.updateExcerptText(rowId, text).then(refreshExcerptFeed)
        .catch((error) => reportOperationError(error, '编辑失败', '修改尚未保存。内容不能为空，请重试。'));
    }, 'plain-text', item.quoteText) },
    { text: '删除', style: 'destructive', onPress: () => Alert.alert('删除这条摘录？', '书内原文和高亮会保留。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => {
        void excerptRepository.deleteExcerpt(rowId).then(refreshExcerptFeed)
          .catch((error) => reportOperationError(error, '删除摘录失败'));
      } },
    ]) },
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
