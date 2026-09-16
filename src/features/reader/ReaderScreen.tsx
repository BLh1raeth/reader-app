import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FoliateReaderDom from './FoliateReaderDom';
import type { ReaderLocation } from './reader-types';
import { markReaderOpen } from './reader-open-performance';
import { useReaderController } from './use-reader-controller';

function progressLabel(location: ReaderLocation | null) {
  if (!location) return '';
  if (location.currentPage && location.totalPages) return `${location.currentPage} / ${location.totalPages}`;
  return `${Math.round(location.percentage)}%`;
}

function ReaderGlassButton({
  accessibilityLabel,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  icon: 'xmark' | 'line.3.horizontal';
  onPress: () => void;
}) {
  const content = (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" hitSlop={10} onPress={onPress} style={styles.glassButtonContent}>
      <SymbolView name={icon} size={icon === 'xmark' ? 23 : 25} tintColor="#171719" weight="semibold" />
    </Pressable>
  );

  if (isGlassEffectAPIAvailable()) {
    return <GlassView colorScheme="light" glassEffectStyle="regular" isInteractive style={styles.glassButton}>{content}</GlassView>;
  }
  return <View style={styles.glassButtonFallback}>{content}</View>;
}

export default function ReaderScreen() {
  const rawBookId = useLocalSearchParams<{ bookId: string | string[] }>().bookId;
  const bookId = Array.isArray(rawBookId) ? rawBookId[0] : rawBookId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const controller = useReaderController(bookId);
  const [chromeVisible, setChromeVisible] = useState(false);

  useEffect(() => {
    if (bookId) markReaderOpen(bookId, 'READER_ROUTE_MOUNTED');
  }, [bookId]);

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
          onDiagnostic={controller.onDiagnostic}
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

      {readerInput ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={[styles.bookTitleContainer, { top: insets.top + 20 }]}>
            <Text numberOfLines={1} style={styles.bookTitle}>{readerInput.book.title}</Text>
          </View>
          {chromeVisible ? (
            <View style={[styles.closeButtonContainer, { top: insets.top + 12 }]}>
              <ReaderGlassButton accessibilityLabel="关闭阅读" icon="xmark" onPress={closeReader} />
            </View>
          ) : null}
          <View pointerEvents="none" style={[styles.positionContainer, { bottom: insets.bottom + 14 }]}>
            <Text style={styles.positionText}>{locationLabel}</Text>
          </View>
          {chromeVisible ? (
            <View style={[styles.readerMenuContainer, { bottom: insets.bottom + 14 }]}>
              <ReaderGlassButton accessibilityLabel="收起阅读控制" icon="line.3.horizontal" onPress={() => setChromeVisible(false)} />
            </View>
          ) : null}
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
  bookTitleContainer: { alignItems: 'center', left: 78, position: 'absolute', right: 78 },
  bookTitle: { color: '#8b8b90', fontSize: 15, fontWeight: '600', letterSpacing: -0.1, lineHeight: 20 },
  closeButtonContainer: { position: 'absolute', right: 22 },
  readerMenuContainer: { position: 'absolute', right: 22 },
  glassButton: { borderRadius: 28, height: 56, width: 56 },
  glassButtonFallback: { backgroundColor: 'rgba(250,250,252,0.86)', borderColor: 'rgba(60,60,67,0.15)', borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, height: 56, shadowColor: '#000000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.1, shadowRadius: 12, width: 56 },
  glassButtonContent: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  positionContainer: { alignItems: 'center', left: 24, position: 'absolute', right: 24 },
  positionText: { color: '#8e8e93', fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '600' },
});
