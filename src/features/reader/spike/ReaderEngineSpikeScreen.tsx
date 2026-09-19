import { File } from 'expo-file-system';
import { Stack } from 'expo-router';
import { uiText } from '../../../localization';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../../design-system/tokens';
import { bookRepository } from '../../library/book-repository';
import type { Book } from '../../library/library-types';
import EpubEngineSpikeDom, {
  type ReaderEngineCandidate,
  type SpikeCommand,
} from './EpubEngineSpikeDom';

type LoadingState = 'books' | 'file' | 'ready' | 'error';

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ReaderEngineSpikeScreen() {
  const insets = useSafeAreaInsets();
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [candidate, setCandidate] = useState<ReaderEngineCandidate>('foliate');
  const [epubBase64, setEpubBase64] = useState<string | null>(null);
  const [state, setState] = useState<LoadingState>('books');
  const [status, setStatus] = useState('正在读取 SQLite 中已导入的 EPUB…');
  const [location, setLocation] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [command, setCommand] = useState<SpikeCommand | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await bookRepository.getAllBooks();
        setBooks(stored);
        if (stored.length) setSelectedBook(stored[0]);
        setState('ready');
        setStatus(stored.length ? '请选择一本已导入 EPUB，然后选择候选引擎。' : '当前书库没有 EPUB；请先从书库导入一本书。');
      } catch (error) {
        setState('error');
        setStatus(error instanceof Error ? error.message : '无法读取 SQLite 书库。');
      }
    })();
  }, []);

  const loadSelectedBook = async () => {
    if (!selectedBook) return;
    setState('file');
    setStatus(`正在从 App 私有目录读取《${selectedBook.title}》…`);
    setEpubBase64(null);
    setLocation(null);
    setCommand(null);
    try {
      const file = new File(selectedBook.fileUri);
      if (!file.exists) throw new Error('这本书的 EPUB 文件已不存在。');
      const base64 = await file.base64();
      setEpubBase64(base64);
      setSession((value) => value + 1);
      setState('ready');
      setStatus(`正在启动 ${candidate === 'foliate' ? 'foliate-js' : 'epub.js'}…`);
    } catch (error) {
      setState('error');
      setStatus(error instanceof Error ? error.message : '无法读取 EPUB 文件。');
    }
  };

  const switchCandidate = (next: ReaderEngineCandidate) => {
    setCandidate(next);
    setEpubBase64(null);
    setLocation(null);
    setCommand(null);
    setStatus(`已选择 ${next === 'foliate' ? 'foliate-js' : 'epub.js'}；请重新载入测试书。`);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: uiText.debug.readerEngine }} />
      <ScrollView contentContainerStyle={styles.controls} style={styles.controlPanel}>
        <Text style={styles.title}>{uiText.debug.readerEngine}</Text>
        <Text style={styles.subtitle}>隔离调试页：不会改写正式 Reader 或书库数据。</Text>

        <Text style={styles.label}>真实 EPUB</Text>
        {books.length ? (
          <View style={styles.bookList}>
            {books.map((book) => {
              const selected = book.id === selectedBook?.id;
              return (
                <Pressable key={book.id} onPress={() => {
                  setSelectedBook(book);
                  setEpubBase64(null);
                  setLocation(null);
                  setCommand(null);
                  setStatus(`已选择《${book.title}》。`);
                }} style={[styles.choice, selected && styles.choiceSelected]}>
                  <Text numberOfLines={1} style={[styles.choiceText, selected && styles.choiceTextSelected]}>{book.title}</Text>
                  <Text style={styles.choiceMeta}>{formatBytes(book.fileSize)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.label}>候选引擎</Text>
        <View style={styles.row}>
          {(['foliate', 'epubjs'] as const).map((engine) => (
            <Pressable key={engine} onPress={() => switchCandidate(engine)} style={[styles.engineButton, candidate === engine && styles.choiceSelected]}>
              <Text style={[styles.choiceText, candidate === engine && styles.choiceTextSelected]}>{engine === 'foliate' ? 'foliate-js' : 'epub.js'}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable disabled={!selectedBook || state === 'file'} onPress={loadSelectedBook} style={[styles.primaryButton, (!selectedBook || state === 'file') && styles.disabled]}>
          {state === 'file' ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>载入并验证</Text>}
        </Pressable>

        <Text style={styles.status}>{status}</Text>
        {location ? <Text numberOfLines={2} style={styles.location}>当前 CFI：{location}</Text> : null}

        {epubBase64 ? (
          <View style={styles.actions}>
            <Pressable onPress={() => setCommand({ nonce: Date.now(), action: 'previous' })} style={styles.action}><Text style={styles.actionText}>上一页</Text></Pressable>
            <Pressable onPress={() => setCommand({ nonce: Date.now(), action: 'next' })} style={styles.action}><Text style={styles.actionText}>下一页</Text></Pressable>
            <Pressable disabled={!location} onPress={() => location && setCommand({ nonce: Date.now(), action: 'recreate', location })} style={[styles.action, !location && styles.disabled]}><Text style={styles.actionText}>重建并恢复 CFI</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.viewer}>
        {epubBase64 ? (
          <EpubEngineSpikeDom
            key={`${candidate}-${session}`}
            epubBase64={epubBase64}
            fileName={`${selectedBook?.id ?? 'spike'}.epub`}
            engine={candidate}
            command={command}
            onStatus={async (message) => setStatus(message)}
            onLocation={async (nextLocation) => setLocation(nextLocation)}
            dom={{ scrollEnabled: false, style: styles.dom }}
          />
        ) : (
          <View style={styles.viewerEmpty}><Text style={styles.viewerEmptyText}>载入后在此显示真实 EPUB 内容。</Text></View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.colors.background },
  controlPanel: { flexGrow: 0, maxHeight: 370 },
  controls: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  title: { fontSize: 20, fontWeight: '700', color: tokens.colors.label },
  subtitle: { fontSize: 12, color: tokens.colors.secondaryLabel },
  label: { marginTop: 4, fontSize: 13, fontWeight: '700', color: tokens.colors.label },
  bookList: { gap: 5 },
  row: { flexDirection: 'row', gap: 8 },
  choice: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#c9c9cf', paddingHorizontal: 10, paddingVertical: 8 },
  choiceSelected: { backgroundColor: '#242428', borderColor: '#242428' },
  choiceText: { fontSize: 13, fontWeight: '600', color: tokens.colors.label },
  choiceTextSelected: { color: '#ffffff' },
  choiceMeta: { marginTop: 2, fontSize: 11, color: tokens.colors.secondaryLabel },
  engineButton: { flex: 1, alignItems: 'center', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#c9c9cf', paddingVertical: 9 },
  primaryButton: { alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 12, backgroundColor: '#242428' },
  primaryText: { fontWeight: '700', color: '#ffffff' },
  disabled: { opacity: 0.42 },
  status: { fontSize: 12, lineHeight: 17, color: tokens.colors.secondaryLabel },
  location: { fontSize: 11, lineHeight: 15, color: tokens.colors.secondaryLabel },
  actions: { flexDirection: 'row', gap: 7 },
  action: { flex: 1, alignItems: 'center', borderRadius: 10, backgroundColor: '#e1e0e6', paddingVertical: 8 },
  actionText: { fontSize: 12, fontWeight: '700', color: tokens.colors.label },
  viewer: { flex: 1, margin: 12, marginTop: 0, overflow: 'hidden', borderRadius: 14, backgroundColor: '#ffffff' },
  dom: { flex: 1 },
  viewerEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  viewerEmptyText: { textAlign: 'center', color: tokens.colors.secondaryLabel },
});
