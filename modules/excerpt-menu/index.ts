import { requireOptionalNativeModule } from 'expo-modules-core';

type ExcerptMenuNativeModule = {
  isAvailable: boolean;
  presentExcerptMenu(x: number, y: number): Promise<string>;
};

const nativeModule = requireOptionalNativeModule<ExcerptMenuNativeModule>('ExcerptMenu');

export const isExcerptMenuNativeAvailable = nativeModule?.isAvailable === true;

export type ExcerptMenuAction = 'copy' | 'share' | 'edit' | 'delete' | 'dismiss';

/**
 * Present the native excerpt long-press menu anchored at the press point
 * (RN `pageX`/`pageY`, i.e. window points). Resolves with the chosen
 * action, or 'dismiss' when the menu is dismissed without a choice
 * (outside tap, or the native module is unavailable).
 */
export async function presentExcerptMenu(point: { x: number; y: number }): Promise<ExcerptMenuAction> {
  if (!nativeModule) return 'dismiss';
  const action = await nativeModule.presentExcerptMenu(point.x, point.y);
  switch (action) {
    case 'copy':
    case 'share':
    case 'edit':
    case 'delete':
    case 'dismiss':
      return action;
    default:
      return 'dismiss';
  }
}
