import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FoliateReaderDom from './FoliateReaderDom';
import type { ReaderLocation } from './reader-types';
import { useReaderController } from './use-reader-controller';

function progressLabel(location: ReaderLocation | null) {
  if (!location) return '';
  if (location.currentPage && location.totalPages) return `${location.currentPage} / ${location.totalPages}`;
  return `${Math.round(location.percentage)}%`;
}

export default function ReaderScreen() {
  const rawBookId = useLocalSearchParams<{ bookId: string | string[] }>().bookId;
  const bookId = Array.isArray(rawBookId) ? rawBookId[0] : rawBookId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const controller = useReaderController(bookId);
  const [chromeVisible, setChromeVisible] = useState(false);

  const readerInput = useMemo(() => controller.state.kind === 'opening'
    ? controller.state
    : controller.state.kind === 'ready'
      ? controller.state
      : null, [controller.state]);
  const locationLabel = progressLabel(controller.currentLocation);

  const closeReader = useCallback(() => {
    void controller.flushLocation().catch(() => undefined).finally(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    });
  }, [controller, router]);

  const toggleChrome = useCallback(async () => {
    setChromeVisible((visible) => !visible);
  }, []);

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />

      {controller.state.kind === 'opening' || controller.state.kind === 'ready' ? (
        <FoliateReaderDom
          source={controller.state.kind === 'opening' ? controller.state.source : null}
          restoreCfi={controller.state.restoreCfi}
          onReady={controller.onEngineReady}
          onLocation={controller.onLocation}
          onChromeRequest={toggleChrome}
          onError={controller.onEngineError}
          dom={{ scrollEnabled: false, style: styles.domReader }}
        />
      ) : null}

      {controller.state.kind === 'loading' ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#767680" />
          <Text style={styles.stateText}>{controller.state.message}</Text>
        </View>
      ) : null}

      {controller.state.kind === 'error' ? (
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>无法打开这本书</Text>
          <Text style={styles.errorMessage}>{controller.state.message}</Text>
          <Pressable accessibilityRole="button" onPress={closeReader} style={styles.returnButton}>
            <Text style={styles.returnButtonText}>返回书库</Text>
          </Pressable>
        </View>
      ) : null}

      {readerInput && chromeVisible ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View pointerEvents="box-none" style={[styles.chromeHeader, { paddingTop: insets.top + 10 }]}>
            <Text numberOfLines={1} style={styles.chromeTitle}>{readerInput.book.title}</Text>
            <Pressable accessibilityLabel="关闭阅读" accessibilityRole="button" hitSlop={12} onPress={closeReader} style={styles.closeButton}>
              <Text style={styles.closeGlyph}>×</Text>
            </Pressable>
          </View>
          <View pointerEvents="none" style={[styles.positionContainer, { bottom: insets.bottom + 14 }]}>
            <Text style={styles.positionText}>{locationLabel}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  domReader: { flex: 1, backgroundColor: '#ffffff' },
  centerState: { alignItems: 'center', backgroundColor: '#ffffff', flex: 1, gap: 12, justifyContent: 'center', paddingHorizontal: 32 },
  stateText: { color: '#767680', fontSize: 14 },
  errorTitle: { color: '#1c1c1e', fontSize: 20, fontWeight: '700' },
  errorMessage: { color: '#767680', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  returnButton: { alignItems: 'center', borderRadius: 20, justifyContent: 'center', minHeight: 40, paddingHorizontal: 18 },
  returnButtonText: { color: '#1c1c1e', fontSize: 16, fontWeight: '600' },
  chromeHeader: { alignItems: 'center', flexDirection: 'row', left: 24, position: 'absolute', right: 20 },
  chromeTitle: { color: '#6d6d72', flex: 1, fontSize: 14, fontWeight: '600', marginRight: 16 },
  closeButton: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  closeGlyph: { color: '#36363a', fontSize: 34, fontWeight: '300', lineHeight: 36 },
  positionContainer: { alignItems: 'center', left: 24, position: 'absolute', right: 24 },
  positionText: { color: '#8e8e93', fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '600' },
});
