import { requireOptionalNativeModule } from 'expo-modules-core';

type ReaderEditMenuNativeModule = {
  isAvailable: boolean;
  isHighlightMenuAvailable?: boolean;
};

const nativeModule = requireOptionalNativeModule<ReaderEditMenuNativeModule>('ReaderEditMenu');

export const isReaderEditMenuNativeAvailable = nativeModule?.isAvailable === true;
export const isReaderHighlightMenuNativeAvailable = nativeModule?.isHighlightMenuAvailable === true;
