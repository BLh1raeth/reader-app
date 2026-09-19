import { requireOptionalNativeModule } from 'expo-modules-core';

type ReaderEditMenuNativeModule = {
  isAvailable: boolean;
};

const nativeModule = requireOptionalNativeModule<ReaderEditMenuNativeModule>('ReaderEditMenu');

export const isReaderEditMenuNativeAvailable = nativeModule?.isAvailable === true;
