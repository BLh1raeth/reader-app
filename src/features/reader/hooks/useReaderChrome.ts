import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cancelAnimation, Easing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * ReaderScreen 巨型组件拆分：阅读器 Chrome（顶部关闭按钮 + 底部控制栏）的
 * 显示/隐藏、玻璃拟态过渡、布局就绪握手。
 *
 * 从 ReaderScreen 原样搬运：所有 state、ref、callback 与依赖数组保持不变。
 * 脚注打开时需要强制隐藏 chrome，原来通过 setReaderChromeVisibleRef 间接调用
 * （只为解决声明顺序问题）；拆分后 hook 直接返回稳定的 setReaderChromeVisible，
 * useFootnotePopover 作为参数接收，不再需要该 ref。
 */
export function useReaderChrome({
  reduceMotion,
  markReaderActivity,
}: {
  reduceMotion: boolean;
  markReaderActivity: () => void;
}) {
  const chromeVisibleRef = useRef(false);
  const chromeMountedRef = useRef(false);
  const chromeLayoutsRef = useRef({ close: false, menu: false });
  const chromeRevealStartedRef = useRef(false);
  const chromeFadePendingRef = useRef(false);
  const chromeReadyFrameRef = useRef<number | null>(null);
  const [chromeMounted, setChromeMounted] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [chromeInteractive, setChromeInteractive] = useState(false);
  const [glassVisible, setGlassVisible] = useState(false);
  const [glassAnimationDuration, setGlassAnimationDuration] = useState(0.24);
  const chromeProgress = useSharedValue(0);

  const unmountChromeAfterFade = useCallback(() => {
    if (!chromeVisibleRef.current) {
      chromeMountedRef.current = false;
      chromeLayoutsRef.current = { close: false, menu: false };
      chromeRevealStartedRef.current = false;
      chromeFadePendingRef.current = false;
      setGlassVisible(false);
      setChromeMounted(false);
    }
  }, []);

  const cancelChromeReadyFrame = useCallback(() => {
    if (chromeReadyFrameRef.current !== null) {
      cancelAnimationFrame(chromeReadyFrameRef.current);
      chromeReadyFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelChromeReadyFrame, [cancelChromeReadyFrame]);

  const beginChromeAfterLayout = useCallback(() => {
    if (!chromeVisibleRef.current || !chromeMountedRef.current || chromeRevealStartedRef.current) return;
    chromeRevealStartedRef.current = true;
    chromeFadePendingRef.current = true;
    setGlassVisible(true);
  }, []);

  useLayoutEffect(() => {
    if (!glassVisible || !chromeFadePendingRef.current || !chromeVisibleRef.current) return;
    chromeFadePendingRef.current = false;
    setChromeInteractive(true);
    const duration = reduceMotion ? 90 : 240;
    chromeProgress.set(withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
  }, [chromeProgress, glassVisible, reduceMotion]);

  const markChromeLayoutReady = useCallback((surface: 'close' | 'menu') => {
    chromeLayoutsRef.current[surface] = true;
    if (!chromeVisibleRef.current || chromeRevealStartedRef.current || chromeReadyFrameRef.current !== null) return;
    if (!chromeLayoutsRef.current.close || !chromeLayoutsRef.current.menu) return;
    chromeReadyFrameRef.current = requestAnimationFrame(() => {
      chromeReadyFrameRef.current = null;
      beginChromeAfterLayout();
    });
  }, [beginChromeAfterLayout]);

  const handleCloseLayout = useCallback(() => markChromeLayoutReady('close'), [markChromeLayoutReady]);
  const handleMenuLayout = useCallback(() => markChromeLayoutReady('menu'), [markChromeLayoutReady]);

  const setReaderChromeVisible = useCallback((visible: boolean) => {
    chromeVisibleRef.current = visible;
    setChromeVisible(visible);
    const duration = reduceMotion ? (visible ? 90 : 80) : (visible ? 240 : 160);
    setGlassAnimationDuration(duration / 1000);
    if (visible) {
      if (!chromeMountedRef.current) {
        chromeMountedRef.current = true;
        chromeLayoutsRef.current = { close: false, menu: false };
        chromeRevealStartedRef.current = false;
        setChromeInteractive(false);
        setGlassVisible(false);
        setChromeMounted(true);
        return;
      }
      cancelChromeReadyFrame();
      chromeRevealStartedRef.current = true;
      chromeFadePendingRef.current = false;
      setGlassVisible(true);
      setChromeInteractive(true);
      chromeProgress.set(withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
      return;
    }
    cancelChromeReadyFrame();
    chromeFadePendingRef.current = false;
    setChromeInteractive(false);
    setGlassVisible(false);
    chromeProgress.set(withTiming(0, { duration, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(unmountChromeAfterFade)();
    }));
  }, [cancelChromeReadyFrame, chromeProgress, reduceMotion, unmountChromeAfterFade]);

  const toggleChrome = useCallback(async () => {
    // Center tap / chrome toggle is reader activity (also covers the DOM
    // onChromeRequest path).
    markReaderActivity();
    setReaderChromeVisible(!chromeVisibleRef.current);
  }, [markReaderActivity, setReaderChromeVisible]);

  return {
    chromeMounted,
    chromeVisible,
    chromeInteractive,
    glassVisible,
    glassAnimationDuration,
    chromeProgress,
    chromeVisibleRef,
    setReaderChromeVisible,
    toggleChrome,
    handleCloseLayout,
    handleMenuLayout,
  };
}
