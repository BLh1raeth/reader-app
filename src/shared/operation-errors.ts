import { Alert } from 'react-native';

export function reportOperationError(error: unknown, title = '操作失败', message = '操作未完成，请重试。') {
  if (__DEV__) console.error('[OPERATION_FAILED]', title, error);
  Alert.alert(title, message);
}

let lastReaderNoticeAt = -Infinity;
export function reportReaderSaveError(error: unknown) {
  if (__DEV__) console.error('[READER_SAVE_FAILED]', error);
  if (Date.now() - lastReaderNoticeAt < 30000) return;
  lastReaderNoticeAt = Date.now();
  Alert.alert('保存失败', '最近的阅读进度或记录未能保存。请检查剩余存储空间，并稍后重试。');
}
