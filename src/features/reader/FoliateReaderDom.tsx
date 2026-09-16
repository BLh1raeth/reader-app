'use dom';

import { useEffect, useRef } from 'react';

import { FoliateEpubEngineAdapter } from './foliate/FoliateEpubEngineAdapter';
import type { ReaderEngineDiagnostic, ReaderEpubSource, ReaderLocation, ReaderResourcePayload, ReaderRestoreState } from './reader-types';

type Props = {
  source: ReaderEpubSource | null;
  restoreCfi: string | null;
  onReady: (location: ReaderLocation) => Promise<void>;
  onLocation: (location: ReaderLocation, restoreState: ReaderRestoreState) => Promise<void>;
  onDiagnostic: (diagnostic: ReaderEngineDiagnostic) => Promise<void>;
  onChromeRequest: () => Promise<void>;
  onError: (message: string) => Promise<void>;
  onResourceRequest: (name: string) => Promise<ReaderResourcePayload | null>;
  dom?: import('expo/dom').DOMProps;
};

export default function FoliateReaderDom({ source, restoreCfi, onReady, onLocation, onDiagnostic, onChromeRequest, onError, onResourceRequest }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<FoliateEpubEngineAdapter | null>(null);
  const loadedSessionRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onReady, onLocation, onDiagnostic, onChromeRequest, onError, onResourceRequest });
  callbacksRef.current = { onReady, onLocation, onDiagnostic, onChromeRequest, onError, onResourceRequest };

  useEffect(() => {
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
    document.body.style.margin = '0';
    const root = document.getElementById('root');
    if (root) root.style.height = '100%';
    void callbacksRef.current.onDiagnostic({ event: 'DOM_READY' });
  }, []);

  useEffect(() => {
    const nextSource = source;
    if (!nextSource || loadedSessionRef.current === nextSource.sessionId || !hostRef.current) return;
    let active = true;
    void callbacksRef.current.onDiagnostic({ event: 'EPUB_TRANSFER_END' });
    const adapter = adapterRef.current ?? new FoliateEpubEngineAdapter(
      hostRef.current,
      (location, restoreState) => { void callbacksRef.current.onLocation(location, restoreState); },
      () => { void callbacksRef.current.onChromeRequest(); },
      (diagnostic) => { void callbacksRef.current.onDiagnostic(diagnostic); },
    );
    adapterRef.current = adapter;
    loadedSessionRef.current = nextSource.sessionId;
    void callbacksRef.current.onDiagnostic({ event: 'FOLIATE_OPEN_START' });
    void adapter.open({
      base64: nextSource.base64,
      entries: nextSource.entries,
      fileName: nextSource.fileName,
      onResourceRequest: (name) => callbacksRef.current.onResourceRequest(name),
      restoreCfi,
      sourceKind: nextSource.sourceKind,
    }).then((location) => {
      if (active) return callbacksRef.current.onReady(location);
      return undefined;
    }).catch((error: unknown) => {
      if (!active) return;
      loadedSessionRef.current = null;
      const message = error instanceof Error ? error.message : String(error);
      void callbacksRef.current.onError(message);
    });
    return () => { active = false; };
  }, [restoreCfi, source]);

  useEffect(() => () => {
    adapterRef.current?.destroy();
    adapterRef.current = null;
  }, []);

  return <div ref={hostRef} style={{ width: '100%', height: '100vh', overflow: 'hidden', background: '#ffffff' }} />;
}
