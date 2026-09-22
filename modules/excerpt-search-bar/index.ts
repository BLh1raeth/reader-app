import { requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';

export type NativeExcerptSearchBarProps = ViewProps & {
  /** 系统 placeholder，如"搜索摘录"——由 iOS 渲染，不手画。 */
  placeholder?: string;
  /** 受控文本；与原生 UISearchBar 双向同步（setText 只在不同时回写）。 */
  text?: string;
  /** 文本变化（含系统清空键），nativeEvent.text 为最新文本。 */
  onTextChange?: (event: { nativeEvent: { text: string } }) => void;
  /** 焦点变化，nativeEvent.focused。 */
  onFocusChange?: (event: { nativeEvent: { focused: boolean } }) => void;
  /** 系统键盘搜索键。 */
  onSubmitEditing?: () => void;
};

/**
 * 真正的 UIKit UISearchBar（本地 Expo Module `excerpt-search-bar` 内嵌），
 * 不是 RN TextInput 模拟。放大镜 / 清空键 / 键盘 / 深浅色 / 无障碍
 * 全部由 iOS 系统提供。
 *
 * 注意：需要包含该模块的新 Development Build 才能运行；
 * 当前已安装的旧 Build 上渲染它会红屏（view manager 不存在）。
 */
export const NativeExcerptSearchBar =
  requireNativeViewManager<NativeExcerptSearchBarProps>('ExcerptSearchBar');
