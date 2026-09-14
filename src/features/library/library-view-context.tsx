import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type LibraryDisplayMode = 'grid' | 'list';

type LibraryViewContextValue = {
  displayMode: LibraryDisplayMode;
  toggleDisplayMode: () => void;
};

const LibraryViewContext = createContext<LibraryViewContextValue | null>(null);

export function LibraryViewProvider({ children }: { children: ReactNode }) {
  const [displayMode, setDisplayMode] = useState<LibraryDisplayMode>('grid');

  const toggleDisplayMode = useCallback(() => {
    Haptics.selectionAsync().catch(() => undefined);
    setDisplayMode((currentMode) => (currentMode === 'grid' ? 'list' : 'grid'));
  }, []);

  const value = useMemo(() => ({ displayMode, toggleDisplayMode }), [displayMode, toggleDisplayMode]);

  return <LibraryViewContext.Provider value={value}>{children}</LibraryViewContext.Provider>;
}

export function useLibraryView() {
  const context = useContext(LibraryViewContext);
  if (!context) {
    throw new Error('useLibraryView must be used inside LibraryViewProvider.');
  }
  return context;
}
