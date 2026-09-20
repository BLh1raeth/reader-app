import { requireOptionalNativeModule } from 'expo-modules-core';

// Formal TS wrapper for the ReaderPopover native module.
//
// This is the only surface ReaderScreen (or future citation/glossary
// callers) should touch — never the raw native module. It exposes:
//   - isNativeReaderPopoverAvailable(): capability check, resolved once at
//     import time. Old dev builds without the native code return false and
//     the caller falls back to the RN footnote overlay.
//   - presentFootnotePopover({ text, anchor, appearance })
//   - dismissFootnotePopover()
//   - addNativeFootnotePopoverDismissListener(): fired when the system
//     dismisses the popover on its own (outside tap), so JS bookkeeping
//     stays in sync.
//
// Coordinate contract (see FoliateEpubEngineAdapter.mapIframeRectToWebView):
// `anchor` is in **native window points** — the same space as RN
// `Dimensions.get('window')`. No scale multiplication: RN layout points and
// UIKit layout points are the same unit. The DOM -> window conversion
// (iframe rect + frame offset + pagination transform) happens in the
// adapter, not here.

export type FootnotePopoverAnchor = {
  /** X in native window points (= RN Dimensions.get('window') points). */
  x: number;
  /** Y in native window points. */
  y: number;
  width: number;
  height: number;
};

export type FootnotePopoverAppearance = 'light' | 'dark';

export type FootnotePopoverPayload = {
  /** Plain sanitized footnote text (first version: no HTML/attributed text). */
  text: string;
  /** Anchor rect in native window points. */
  anchor: FootnotePopoverAnchor;
  /**
   * Follows the Reader's own appearance setting. Required (not premature):
   * the app forces UIUserInterfaceStyle=Light in app.json, so without
   * passing this the native popover could never match Reader dark mode.
   */
  appearance: FootnotePopoverAppearance;
};

type ReaderPopoverNativeModule = {
  isAvailable: boolean;
  presentFootnotePopover(
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    appearance: 'light' | 'dark',
  ): Promise<void>;
  dismissFootnotePopover(): Promise<void>;
};

const nativeModule =
  requireOptionalNativeModule<ReaderPopoverNativeModule>('ReaderPopover');

export function isNativeReaderPopoverAvailable(): boolean {
  return nativeModule?.isAvailable === true;
}

export async function presentFootnotePopover(
  payload: FootnotePopoverPayload,
): Promise<void> {
  if (!nativeModule) {
    throw new Error('ReaderPopover native module is not available');
  }
  const { text, anchor, appearance } = payload;
  await nativeModule.presentFootnotePopover(
    anchor.x,
    anchor.y,
    anchor.width,
    anchor.height,
    text,
    appearance,
  );
}

export async function dismissFootnotePopover(): Promise<void> {
  await nativeModule?.dismissFootnotePopover();
}

// Structural view of the native module's event-emitter surface (since Expo
// SDK 52 the native module object itself is an emitter; no wrapper needed).
type NativePopoverEventEmitter = {
  addListener(
    eventName: 'onFootnotePopoverDismiss',
    listener: () => void,
  ): { remove(): void };
};

export function addNativeFootnotePopoverDismissListener(
  listener: () => void,
): { remove: () => void } {
  if (!nativeModule) {
    return { remove: () => {} };
  }
  const emitter = nativeModule as unknown as NativePopoverEventEmitter;
  const subscription = emitter.addListener('onFootnotePopoverDismiss', listener);
  return { remove: () => subscription.remove() };
}
