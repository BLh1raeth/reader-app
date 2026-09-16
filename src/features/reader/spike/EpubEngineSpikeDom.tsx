'use dom';

import ePub from 'epubjs';
import { useEffect, useRef } from 'react';

export type ReaderEngineCandidate = 'foliate' | 'epubjs';

export type SpikeCommand =
  | { nonce: number; action: 'next' | 'previous' }
  | { nonce: number; action: 'recreate'; location: string };

type Props = {
  epubBase64: string;
  fileName: string;
  engine: ReaderEngineCandidate;
  command: SpikeCommand | null;
  onStatus: (message: string) => Promise<void>;
  onLocation: (location: string | null) => Promise<void>;
  dom?: import('expo/dom').DOMProps;
};

type FoliateView = HTMLElement & {
  open: (book: File | Blob) => Promise<void>;
  init: (options: { lastLocation: string | null; showTextStart: boolean }) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  goTo: (target: string) => Promise<void>;
  close: () => void;
  lastLocation?: { cfi?: string };
};

type EpubRendition = {
  display: (target?: string) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  currentLocation: () => { start?: { cfi?: string } } | null;
  on: (event: 'relocated', callback: (location: { start?: { cfi?: string } }) => void) => void;
  destroy: () => void;
};

type EpubBook = {
  ready: Promise<unknown>;
  renderTo: (element: HTMLElement, options: Record<string, unknown>) => EpubRendition;
  destroy: () => void;
};

type EngineSession = {
  next: () => Promise<void>;
  previous: () => Promise<void>;
  getLocation: () => string | null;
  destroy: () => void;
};

function base64ToBytes(base64: string) {
  const binary = globalThis.atob(base64);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

export default function EpubEngineSpikeDom({
  epubBase64,
  fileName,
  engine,
  command,
  onStatus,
  onLocation,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<EngineSession | null>(null);
  const latestLocationRef = useRef<string | null>(null);
  const inputRef = useRef({ epubBase64, fileName, engine, onStatus, onLocation });
  inputRef.current = { epubBase64, fileName, engine, onStatus, onLocation };

  const reportLocation = async (location: string | null) => {
    latestLocationRef.current = location;
    await inputRef.current.onLocation(location);
  };

  const openEngine = async (restoreLocation: string | null) => {
    const host = hostRef.current;
    if (!host) throw new Error('DOM 容器尚未就绪。');

    // Expo DOM's generated HTML gives #root flex behaviour but does not assign
    // a height to html/body. EPUB engines measure their host synchronously;
    // without this, they can paginate into a zero-height iframe and report a
    // CFI while presenting an empty white surface.
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
    document.body.style.margin = '0';
    const root = document.getElementById('root');
    if (root) root.style.height = '100%';

    sessionRef.current?.destroy();
    sessionRef.current = null;
    host.replaceChildren();

    const { epubBase64: source, fileName: name, engine: candidate } = inputRef.current;
    const bytes = base64ToBytes(source);

    if (candidate === 'foliate') {
      // foliate-js registers <foliate-view> when this ESM module is loaded.
      await import('foliate-js/view.js');
      const view = document.createElement('foliate-view') as FoliateView;
      view.style.display = 'block';
      view.style.width = '100%';
      view.style.height = '100%';
      view.setAttribute('flow', 'paginated');
      view.setAttribute('margin', '24px');
      view.setAttribute('gap', '7%');
      view.addEventListener('relocate', () => {
        const cfi = view.lastLocation?.cfi ?? null;
        void reportLocation(cfi);
      });
      host.append(view);
      const file = new File([bytes], name || 'spike.epub', { type: 'application/epub+zip' });
      await view.open(file);
      await view.init({ lastLocation: restoreLocation, showTextStart: true });
      const initialLocation = view.lastLocation?.cfi ?? restoreLocation;
      await reportLocation(initialLocation ?? null);
      await inputRef.current.onStatus(`foliate-js 已加载，${initialLocation ? '已得到 EPUB CFI。' : '尚未得到 CFI。'}`);
      sessionRef.current = {
        next: () => view.next(),
        previous: () => view.prev(),
        getLocation: () => view.lastLocation?.cfi ?? null,
        destroy: () => {
          view.close();
          view.remove();
        },
      };
      return;
    }

    const book = ePub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as unknown as EpubBook;
    await book.ready;
    const rendition = book.renderTo(host, {
      width: window.innerWidth,
      height: window.innerHeight,
      flow: 'paginated',
      spread: 'none',
      manager: 'default',
      allowScriptedContent: false,
    });
    rendition.on('relocated', (location) => {
      void reportLocation(location.start?.cfi ?? null);
    });
    await rendition.display(restoreLocation ?? undefined);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (!host.querySelector('iframe')) throw new Error('epub.js 未创建章节 iframe。');
    const initialLocation = rendition.currentLocation()?.start?.cfi ?? restoreLocation;
    await reportLocation(initialLocation ?? null);
    await inputRef.current.onStatus(`epub.js 已加载，${initialLocation ? '已得到 EPUB CFI。' : '尚未得到 CFI。'}`);
    sessionRef.current = {
      next: () => rendition.next(),
      previous: () => rendition.prev(),
      getLocation: () => rendition.currentLocation()?.start?.cfi ?? null,
      destroy: () => {
        rendition.destroy();
        book.destroy();
        host.replaceChildren();
      },
    };
  };

  useEffect(() => {
    let active = true;
    void openEngine(null).catch(async (error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : String(error);
      await inputRef.current.onStatus(`${inputRef.current.engine} 启动失败：${message}`);
    });
    return () => {
      active = false;
      sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, [epubBase64, engine, fileName]);

  // Marshalled prop updates are the documented, one-way bridge for DOM
  // Components. Keeping test controls on this path avoids relying on an
  // imperative ref while testing pagination.
  useEffect(() => {
    if (!command?.nonce) return;
    void (async () => {
      const session = sessionRef.current;
      if (!session) {
        await inputRef.current.onStatus('引擎尚未准备好，无法翻页。');
        return;
      }
      try {
        if (command.action === 'recreate') {
          await inputRef.current.onStatus('正在重新创建引擎并恢复保存的位置…');
          await openEngine(command.location);
          await inputRef.current.onStatus('重新创建完成；请核对是否回到相同段落。');
          return;
        }
        await (command.action === 'next' ? session.next() : session.previous());
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const nextLocation = sessionRef.current?.getLocation() ?? null;
        await reportLocation(nextLocation);
        await inputRef.current.onStatus(`${command.action === 'next' ? '下一页' : '上一页'}命令已执行${nextLocation ? '，CFI 已更新。' : '。'}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await inputRef.current.onStatus(`${command.action === 'next' ? '下一页' : '上一页'}失败：${message}`);
      }
    })();
  }, [command?.nonce]);

  return (
    <div
      ref={hostRef}
      style={{
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
        background: '#ffffff',
      }}
    />
  );
}
