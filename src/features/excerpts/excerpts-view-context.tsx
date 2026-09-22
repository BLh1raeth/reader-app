import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated } from 'react-native';

/**
 * Excerpts Tab Core E：按时间 / 按书籍浏览模式。
 *
 * 与书库 Grid/List 对齐：纯内存 state，不持久化（书库 displayMode 也是
 * useState 内存态，重启回默认）。产品规则统一为：
 *
 * 切换由 app/(tabs)/_layout.tsx 的 tabPress re-tap 监听触发，
 * 复用书库已经验证过的 current-tab reselect 判定（route.name + pathname）。
 */
export type ExcerptsViewMode = 'time' | 'books';

/**
 * 模式切换淡入淡出参数：淡出只压到 0.3（不全隐，避免"闪烁感"），
 * 淡出 80ms 稍快、淡入 140ms 稍慢，读起来是"轻点一下"而不是"眨一下眼"。
 */
const FADE_MIN_OPACITY = 0.3;
const FADE_OUT_MS = 80;
const FADE_IN_MS = 140;

type ExcerptsViewContextValue = {
  viewMode: ExcerptsViewMode;
  toggleViewMode: () => void;
  /**
   * 模式切换时的列表淡入淡出：toggle 先把透明度压到 0，
   * viewMode 翻转、新 sections 渲染后再回到 1。
   * ExcerptsScreen 把它绑到列表外层 Animated.View 的 opacity 上。
   * 搜索输入 / Feed 刷新不经过这里，不会触发淡入淡出。
   */
  listOpacity: Animated.Value;
};

const ExcerptsViewContext = createContext<ExcerptsViewContextValue | null>(null);

export function ExcerptsViewProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ExcerptsViewMode>('time');
  const listOpacity = useRef(new Animated.Value(1)).current;

  const toggleViewMode = useCallback(() => {
    // 快速连点 tab：停掉进行中的动画，从当前透明度重新淡出；
    // 被停掉的淡出回调 finished=false，直接丢弃，不翻转，保证最终回到 1。
    listOpacity.stopAnimation();
    Animated.timing(listOpacity, {
      // 只压到 0.3 不全隐：全隐再回来读起来像"闪烁"，留个底更柔和。
      toValue: FADE_MIN_OPACITY,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setViewMode((mode) => (mode === 'time' ? 'books' : 'time'));
      // 等新 sections 提交、渲染完（双 rAF）后再淡入，避免新内容还没上屏就开始淡入。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          Animated.timing(listOpacity, {
            toValue: 1,
            duration: FADE_IN_MS,
            useNativeDriver: true,
          }).start();
        });
      });
    });
  }, [listOpacity]);

  const value = useMemo(
    () => ({ viewMode, toggleViewMode, listOpacity }),
    [viewMode, toggleViewMode, listOpacity],
  );

  return <ExcerptsViewContext.Provider value={value}>{children}</ExcerptsViewContext.Provider>;
}

export function useExcerptsView() {
  const context = useContext(ExcerptsViewContext);
  if (!context) {
    throw new Error('useExcerptsView must be used inside ExcerptsViewProvider.');
  }
  return context;
}
