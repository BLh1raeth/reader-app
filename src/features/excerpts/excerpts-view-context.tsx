import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

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

type ExcerptsViewContextValue = {
  viewMode: ExcerptsViewMode;
  toggleViewMode: () => void;
};

const ExcerptsViewContext = createContext<ExcerptsViewContextValue | null>(null);

export function ExcerptsViewProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ExcerptsViewMode>('time');

  const toggleViewMode = useCallback(() => {
    setViewMode((mode) => (mode === 'time' ? 'books' : 'time'));
  }, []);

  const value = useMemo(
    () => ({ viewMode, toggleViewMode }),
    [viewMode, toggleViewMode],
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
