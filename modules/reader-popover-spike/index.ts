import { requireOptionalNativeModule } from 'expo-modules-core';

export type SpikePopoverAnchor = {
  /** X in window points (RN Dimensions.get('window') space). */
  x: number;
  /** Y in window points. */
  y: number;
  width: number;
  height: number;
};

type ReaderPopoverSpikeNativeModule = {
  isAvailable: boolean;
  presentSpikePopover(
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
  ): Promise<void>;
  dismissSpikePopover(): Promise<void>;
};

const nativeModule =
  requireOptionalNativeModule<ReaderPopoverSpikeNativeModule>('ReaderPopoverSpike');

export const isReaderPopoverSpikeAvailable = nativeModule?.isAvailable === true;

export async function presentSpikePopover(
  anchor: SpikePopoverAnchor,
  text: string,
): Promise<void> {
  await nativeModule?.presentSpikePopover(anchor.x, anchor.y, anchor.width, anchor.height, text);
}

export async function dismissSpikePopover(): Promise<void> {
  await nativeModule?.dismissSpikePopover();
}
