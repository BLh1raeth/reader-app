import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type LibraryDisplayMode = 'grid' | 'list';

type LibraryViewContextValue = {
  displayMode: LibraryDisplayMode;
  isTabBarHidden: boolean;
  setTabBarHidden: (hidden: boolean) => void;
  toggleDisplayMode: () => void;
};

const LibraryViewContext = createContext<LibraryViewContextValue | null>(null);

export function LibraryViewProvider({ children }: { children: ReactNode }) {
  const [displayMode, setDisplayMode] = useState<LibraryDisplayMode>('grid');
  const [isTabBarHidden, setTabBarHidden] = useState(false);

  const toggleDisplayMode = useCallback(() => {
    Haptics.selectionAsync().catch(() => undefined);
    setDisplayMode((currentMode) => (currentMode === 'grid' ? 'list' : 'grid'));
  }, []);

  const value = useMemo(
    () => ({ displayMode, isTabBarHidden, setTabBarHidden, toggleDisplayMode }),
    [displayMode, isTabBarHidden, toggleDisplayMode],
  );

  return <LibraryViewContext.Provider value={value}>{children}</LibraryViewContext.Provider>;
}

export function useLibraryView() {
  const context = useContext(LibraryViewContext);
  if (!context) {
    throw new Error('useLibraryView must be used inside LibraryViewProvider.');
  }
  return context;
}
