import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { AppState, Dimensions, View } from 'react-native';
import {
  addNativeFootnotePopoverDismissListener,
  dismissFootnotePopover as dismissNativeFootnotePopover,
  isNativeReaderPopoverAvailable,
  presentFootnotePopover as presentNativeFootnotePopover,
} from '../../../../modules/reader-popover';
import type { FootnoteAnchorRect, FootnotePayload } from '../reader-types';

const FOOTNOTE_POPOVER_WIDTH_RATIO = 0.76;
const FOOTNOTE_POPOVER_MAX_HEIGHT_RATIO = 0.42;
const FOOTNOTE_POPOVER_EDGE_GAP = 12;
const FOOTNOTE_POPOVER_ANCHOR_GAP = 8;
const FOOTNOTE_POPOVER_MIN_HEIGHT = 96;

const isSameFootnoteAnchor = (a: FootnoteAnchorRect, b: FootnoteAnchorRect) =>
  Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;

/**
 * ReaderScreen 巨型组件拆分：脚注 popover（原生 popover + RN 降级 overlay）。
 *
 * 从 ReaderScreen 原样搬运：所有 state、ref、callback、effect 与依赖数组保持不变。
 * 交叉依赖显式作为参数传入：
 * - chromeVisibleRef / setReaderChromeVisible：脚注打开时强制隐藏 chrome
 *   （原来经 setReaderChromeVisibleRef 间接调用，现由 useReaderChrome 直接返回）。
 * - toc/settings/searchSheetPresented：任一 sheet 打开时关闭 popover。
 * - viewport / insets：popover 布局计算。
 */
export function useFootnotePopover({
  markReaderActivity,
  readerAppearance,
  bookId,
  chromeVisibleRef,
  setReaderChromeVisible,
  tocSheetPresented,
  settingsSheetPresented,
  searchSheetPresented,
  viewportWidth,
  viewportHeight,
  insetTop,
  insetBottom,
}: {
  markReaderActivity: () => void;
  readerAppearance: 'light' | 'dark';
  bookId: string | undefined;
  chromeVisibleRef: RefObject<boolean>;
  setReaderChromeVisible: (visible: boolean) => void;
  tocSheetPresented: boolean;
  settingsSheetPresented: boolean;
  searchSheetPresented: boolean;
  viewportWidth: number;
  viewportHeight: number;
  insetTop: number;
  insetBottom: number;
}) {
  const [footnotePopover, setFootnotePopover] = useState<FootnotePayload | null>(null);
  // True while any footnote popover is on screen (native or RN fallback).
  // Forwarded to the DOM gesture layer as a plain prop so taps are classified
  // synchronously: while open, a tap only dismisses the popover and never
  // turns the page or toggles chrome. Updated at every open/close site below.
  const [footnoteModalOpen, setFootnoteModalOpen] = useState(false);
  // Anchor of the currently shown *native* footnote popover (null when none
  // or when the RN fallback overlay is used). System outside-tap dismisses
  // are reported back through the native dismiss event below.
  const nativeFootnoteAnchorRef = useRef<FootnoteAnchorRect | null>(null);
  // Reader root view; DEV-only coordinate verification measures its window
  // origin to prove the anchor math shares the window coordinate space.
  const readerRootRef = useRef<View>(null);

  // RN fallback overlay path: kept until the native popover is verified on a
  // real Development Build. Used only when the native module is unavailable
  // or native presentation throws. Never shown together with the native one.
  const openFootnoteFallbackOverlay = useCallback((payload: FootnotePayload) => {
    setFootnotePopover((current) => {
      if (
        current &&
        current.id === payload.id &&
        current.sourceHref === payload.sourceHref &&
        isSameFootnoteAnchor(current.anchorRect, payload.anchorRect)
      ) {
        // Re-tapping the same anchor toggles the popover closed.
        if (__DEV__) console.log('[FOOTNOTE_CLOSE]');
        setFootnoteModalOpen(false);
        return null;
      }
      setFootnoteModalOpen(true);
      return payload;
    });
  }, []);

  const handleFootnoteOpen = useCallback(async (payload: FootnotePayload) => {
    // Footnote open/close is reading activity; the popover itself does not
    // block active time (unlike TOC/search/settings sheets).
    markReaderActivity();
    // A footnote tap is a reading action, not a chrome action: opening the
    // popover must keep the reader in immersive mode. The tap's pointer-up
    // fires before the click is classified as a footnote, so a chrome toggle
    // from that same tap may already be in flight; force chrome hidden here
    // instead of racing that earlier toggle. This also covers the toggle-off
    // path below (re-tapping the marker never leaves chrome visible).
    if (chromeVisibleRef.current) {
      if (__DEV__) console.log('[FOOTNOTE_CHROME_HIDE]');
      setReaderChromeVisible(false);
    }
    if (__DEV__) {
      // Empirical anchor-space check (no footnote content is logged). The
      // Reader root is flex:1 at window origin (0,0); if readerRootWindowRect
      // ever drifts from (0,0), the adapter's anchor math must be revisited
      // before trusting native popover alignment.
      readerRootRef.current?.measureInWindow((rx, ry, rw, rh) => {
        const { width: ww, height: wh } = Dimensions.get('window');
        console.log('[FOOTNOTE_COORD_VERIFY]', JSON.stringify({
          mappedRect: payload.anchorRect,
          readerRootWindowRect: {
            x: Math.round(rx * 100) / 100,
            y: Math.round(ry * 100) / 100,
            width: Math.round(rw),
            height: Math.round(rh),
          },
          windowSize: { width: Math.round(ww), height: Math.round(wh) },
          finalWindowRect: payload.anchorRect,
        }));
      });
    }
    if (isNativeReaderPopoverAvailable()) {
      const shown = nativeFootnoteAnchorRef.current;
      if (shown && isSameFootnoteAnchor(shown, payload.anchorRect)) {
        // Same noteref tapped again: toggle the native popover closed.
        // At most one native popover ever exists; never stack a second one.
        if (__DEV__) console.log('[FOOTNOTE_CLOSE]');
        nativeFootnoteAnchorRef.current = null;
        setFootnoteModalOpen(false);
        try {
          await dismissNativeFootnotePopover();
        } catch (error) {
          if (__DEV__) console.log('[FOOTNOTE_NATIVE_DISMISS_FAILED]', String(error));
        }
        return;
      }
      try {
        // payload.anchorRect is already in native window points
        // (FoliateEpubEngineAdapter.mapIframeRectToWebView). RN layout points
        // and UIKit layout points are the same unit: no scaling here.
        await presentNativeFootnotePopover({
          text: payload.text,
          anchor: payload.anchorRect,
          appearance: readerAppearance,
        });
        nativeFootnoteAnchorRef.current = payload.anchorRect;
        setFootnoteModalOpen(true);
        if (__DEV__) console.log('[FOOTNOTE_OPEN_NATIVE]');
        return;
      } catch (error) {
        // Native presentation failed: fall through to the RN overlay so the
        // tap is never swallowed silently. Never render both at once.
        nativeFootnoteAnchorRef.current = null;
        if (__DEV__) console.log('[FOOTNOTE_NATIVE_FAILED]', String(error));
      }
    }
    openFootnoteFallbackOverlay(payload);
  }, [markReaderActivity, readerAppearance, openFootnoteFallbackOverlay, chromeVisibleRef, setReaderChromeVisible]);

  const dismissFootnotePopover = useCallback(() => {
    if (__DEV__) console.log('[FOOTNOTE_CLOSE]');
    markReaderActivity();
    // Clear native first, then the RN fallback state; at most one is ever set.
    nativeFootnoteAnchorRef.current = null;
    setFootnoteModalOpen(false);
    dismissNativeFootnotePopover().catch((error) => {
      if (__DEV__) console.log('[FOOTNOTE_NATIVE_DISMISS_FAILED]', String(error));
    });
    setFootnotePopover(null);
  }, [markReaderActivity]);

  // The system tells us when it dismisses the native popover on its own
  // (outside tap / swipe). The touch is consumed by the presentation, so it
  // never reaches reader gestures: the next tap behaves normally again.
  useEffect(() => {
    if (!isNativeReaderPopoverAvailable()) return;
    const subscription = addNativeFootnotePopoverDismissListener(() => {
      if (__DEV__) console.log('[FOOTNOTE_CLOSE]');
      nativeFootnoteAnchorRef.current = null;
      setFootnoteModalOpen(false);
    });
    return () => subscription.remove();
  }, []);

  // Never let a native popover outlive the reader route, the current book,
  // or the foreground session.
  useEffect(() => {
    return () => {
      nativeFootnoteAnchorRef.current = null;
      setFootnoteModalOpen(false);
      dismissNativeFootnotePopover().catch(() => undefined);
    };
  }, [bookId]);

  useEffect(() => {
    if (!isNativeReaderPopoverAvailable()) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        nativeFootnoteAnchorRef.current = null;
        setFootnoteModalOpen(false);
        dismissNativeFootnotePopover().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, []);

  // The footnote popover never floats above sheets; opening one dismisses it.
  useEffect(() => {
    if (tocSheetPresented || settingsSheetPresented || searchSheetPresented) {
      nativeFootnoteAnchorRef.current = null;
      dismissNativeFootnotePopover().catch(() => undefined);
      setFootnotePopover(null);
      setFootnoteModalOpen(false);
    }
  }, [tocSheetPresented, settingsSheetPresented, searchSheetPresented]);

  const footnotePopoverLayout = useMemo(() => {
    if (!footnotePopover) return null;
    const width = Math.round(viewportWidth * FOOTNOTE_POPOVER_WIDTH_RATIO);
    const cappedMaxHeight = Math.round(viewportHeight * FOOTNOTE_POPOVER_MAX_HEIGHT_RATIO);
    const anchor = footnotePopover.anchorRect;
    const anchorCenterX = anchor.x + anchor.width / 2;
    const left = Math.min(
      viewportWidth - width - FOOTNOTE_POPOVER_EDGE_GAP,
      Math.max(FOOTNOTE_POPOVER_EDGE_GAP, anchorCenterX - width / 2),
    );
    const spaceAbove = anchor.y - insetTop - FOOTNOTE_POPOVER_ANCHOR_GAP;
    const spaceBelow = viewportHeight - insetBottom - (anchor.y + anchor.height) - FOOTNOTE_POPOVER_ANCHOR_GAP;
    // Prefer above the anchor; fall back below when space is tight. Anchoring
    // by the bottom edge lets short popovers shrink toward the anchor without
    // measuring content height.
    const placeAbove = spaceAbove >= FOOTNOTE_POPOVER_MIN_HEIGHT || spaceAbove >= spaceBelow;
    if (placeAbove) {
      return {
        left,
        width,
        bottom: viewportHeight - anchor.y + FOOTNOTE_POPOVER_ANCHOR_GAP,
        maxHeight: Math.max(FOOTNOTE_POPOVER_MIN_HEIGHT, Math.min(cappedMaxHeight, spaceAbove)),
      };
    }
    return {
      left,
      width,
      top: anchor.y + anchor.height + FOOTNOTE_POPOVER_ANCHOR_GAP,
      maxHeight: Math.max(FOOTNOTE_POPOVER_MIN_HEIGHT, Math.min(cappedMaxHeight, spaceBelow)),
    };
  }, [footnotePopover, insetBottom, insetTop, viewportHeight, viewportWidth]);

  return {
    footnotePopover,
    footnoteModalOpen,
    readerRootRef,
    handleFootnoteOpen,
    dismissFootnotePopover,
    footnotePopoverLayout,
  };
}
