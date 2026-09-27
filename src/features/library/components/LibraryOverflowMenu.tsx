import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import type { SFSymbol } from 'sf-symbols-typescript';
import type { SharedValue } from 'react-native-reanimated';

import { uiText } from '../../../localization';
import { filterLabels, sortLabels } from './library-shared';
import type { FilterMode, SortMode } from './library-shared';
import { LibraryMenuTrigger } from './LibraryMenuTrigger';

export function LibraryOverflowMenu({ booksExist, filterMode, sortMode, onImport, onSelect, onSort, onFilter, onAdjustOrder, onExportBackup, onImportBackup, selectionProgress, importProgress }: {
  booksExist: boolean;
  filterMode: FilterMode;
  sortMode: SortMode;
  onImport: () => void;
  onSelect: () => void;
  onSort: (sortMode: SortMode) => void;
  onFilter: (filterMode: FilterMode) => void;
  onAdjustOrder: () => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  selectionProgress: SharedValue<number>;
  /** 0..1 while importing, null when idle. */
  importProgress: number | null;
}) {
  const bookActions: MenuAction[] = booksExist
    ? [
      { id: 'select', title: '选择', image: 'checkmark.circle' as SFSymbol },
      { id: 'adjust-order', title: '调整顺序', image: 'line.3.horizontal' as SFSymbol },
        {
          id: 'sort',
          title: '排序方式',
          image: 'arrow.up.arrow.down' as SFSymbol,
          subactions: (Object.keys(sortLabels) as SortMode[]).map((option) => ({
            id: `sort:${option}`,
            title: sortLabels[option],
            state: sortMode === option ? 'on' : 'off',
          })),
        },
        {
          id: 'filter',
          title: '筛选',
          image: 'line.3.horizontal.decrease.circle' as SFSymbol,
          subactions: (Object.keys(filterLabels) as FilterMode[]).map((option) => ({
            id: `filter:${option}`,
            title: filterLabels[option],
            state: filterMode === option ? 'on' : 'off',
          })),
        },
      ]
    : [];
  const actions: MenuAction[] = [
    { id: 'import', title: '导入图书', image: 'square.and.arrow.down' as SFSymbol },
    ...bookActions,
    {
      id: 'backup',
      title: uiText.library.backupMenuItem,
      image: 'externaldrive' as SFSymbol,
      subactions: [
        { id: 'backup:export', title: uiText.library.exportBackup, image: 'square.and.arrow.up' as SFSymbol },
        { id: 'backup:import', title: uiText.library.importBackup, image: 'square.and.arrow.down' as SFSymbol },
      ],
    },
  ];

  const handleMenuAction = (actionId: string) => {
    if (actionId === 'import') {
      onImport();
    } else if (actionId === 'backup:export') {
      onExportBackup();
    } else if (actionId === 'backup:import') {
      onImportBackup();
    } else if (actionId === 'select') {
      onSelect();
    } else if (actionId === 'adjust-order') {
      onAdjustOrder();
    } else if (actionId.startsWith('sort:')) {
      onSort(actionId.slice(5) as SortMode);
    } else if (actionId.startsWith('filter:')) {
      onFilter(actionId.slice(7) as FilterMode);
    }
  };

  return (
    <MenuView actions={actions} onPressAction={(event) => handleMenuAction(event.nativeEvent.event)}>
      <LibraryMenuTrigger selectionProgress={selectionProgress} importProgress={importProgress} />
    </MenuView>
  );
}
