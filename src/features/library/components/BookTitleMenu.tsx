import type { ReactNode } from 'react';
import { View } from 'react-native';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import type { SFSymbol } from 'sf-symbols-typescript';

import type { BookMenuHandlers, LibraryBook } from './library-shared';
import { styles } from './library-styles';

export function BookTitleMenu({ book, children, handlers }: {
  book: LibraryBook;
  children: ReactNode;
  handlers?: BookMenuHandlers;
}) {
  if (!handlers) {
    return <View style={styles.bookTitleMenu}>{children}</View>;
  }

  const actions: MenuAction[] = [
    { id: 'share', image: 'square.and.arrow.up' as SFSymbol, title: '分享' },
    {
      id: 'toggle-finished',
      image: (book.state === 'finished' ? 'arrow.uturn.backward' : 'checkmark.circle') as SFSymbol,
      title: book.state === 'finished' ? '标记为未读' : '标记为已读完',
    },
    {
      id: 'edit-info',
      image: 'info.circle' as SFSymbol,
      title: '编辑图书信息',
      subactions: [
        { id: 'edit-cover', image: 'photo' as SFSymbol, title: '封面' },
        { id: 'edit-title', image: 'pencil' as SFSymbol, title: '书名' },
        { id: 'edit-author', image: 'person' as SFSymbol, title: '作者' },
        { id: 'restore-original', image: 'arrow.counterclockwise' as SFSymbol, title: '恢复原始信息' },
      ],
    },
    { id: 'remove', image: 'trash' as SFSymbol, title: '移除', attributes: { destructive: true } },
  ];

  const handleAction = (actionId: string) => {
    if (actionId === 'share') handlers.onShare(book);
    if (actionId === 'toggle-finished') handlers.onToggleFinished(book);
    if (actionId === 'edit-cover') handlers.onEditCover(book);
    if (actionId === 'edit-title') handlers.onEditTitle(book);
    if (actionId === 'edit-author') handlers.onEditAuthor(book);
    if (actionId === 'restore-original') handlers.onRestoreOriginal(book);
    if (actionId === 'remove') handlers.onRemove();
  };

  return (
    <MenuView actions={actions} onPressAction={(event) => handleAction(event.nativeEvent.event)} style={styles.bookTitleMenu} title={book.title}>
      {children}
    </MenuView>
  );
}
