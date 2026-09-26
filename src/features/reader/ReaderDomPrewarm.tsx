import { View } from 'react-native';

import FoliateReaderDom from './FoliateReaderDom';
import { DEFAULT_READER_SETTINGS } from './reader-settings';

const noop = () => {};
const noopAsync = async () => {};
const noopAsyncNull = async () => null;

/**
 * Hidden pre-warmed reader DOM, mounted once at app launch (see
 * app/_layout.tsx). Its only job is to pay the WKWebView cold-start cost
 * (process creation + DOM JS bundle load) before the first book open, so a
 * later open reuses the warm process and cached bundle instead of paying
 * 1.7-3.5s serially after the tap.
 *
 * It never receives a source, so it never builds an engine or opens a book;
 * all bridge callbacks are inert stubs. The real reader route still mounts
 * its own FoliateReaderDom per open — this instance is purely a warm-up.
 */
export default function ReaderDomPrewarm() {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
    >
      <FoliateReaderDom
        source={null}
        restoreCfi={null}
        externalTargetCfi={null}
        excerptNavigationRequest={null}
        onExcerptNavigationResult={noopAsync}
        pageCountCache={null}
        readerSettings={DEFAULT_READER_SETTINGS}
        settingsSessionActive={false}
        tocNavigationRequest={null}
        bookmarkSnapshotRequest={null}
        bookmarkNavigationRequest={null}
        pageLocationRequest={null}
        searchRequest={null}
        searchNavigationRequest={null}
        selectionCommand={null}
        excerptVerificationRequest={null}
        highlightSnapshot={null}
        textMeasureRequest={null}
        onTextMeasureResult={noopAsync}
        onHighlightDeleteRequest={noop}
        onReady={noopAsync}
        onLocation={noopAsync}
        onDiagnostic={noopAsync}
        onChromeRequest={noopAsync}
        onError={noopAsync}
        onResourceRequest={noopAsyncNull}
        onPageCount={noopAsync}
        onToc={noopAsync}
        onTocNavigationResult={noopAsync}
        onBookmarkSnapshot={noopAsync}
        onBookmarkNavigationResult={noopAsync}
        onPageLocationUpdate={noopAsync}
        onSearchUpdate={noopAsync}
        onSearchNavigationResult={noopAsync}
        footnoteModalOpen={false}
        notePopoverOpen={false}
      />
    </View>
  );
}
