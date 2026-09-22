import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePathname } from 'expo-router';
import { PlatformColor } from 'react-native';

import { LibraryViewProvider, useLibraryView } from '../../src/features/library/library-view-context';
import { ExcerptsViewProvider, useExcerptsView } from '../../src/features/excerpts/excerpts-view-context';
import { uiText } from '../../src/localization';

export default function TabLayout() {
  return (
    <LibraryViewProvider>
      <ExcerptsViewProvider>
        <AppTabs />
      </ExcerptsViewProvider>
    </LibraryViewProvider>
  );
}

function AppTabs() {
  const pathname = usePathname();
  const { isTabBarHidden, toggleDisplayMode } = useLibraryView();
  const { toggleViewMode } = useExcerptsView();
  const booksTabColor = PlatformColor('label');

  return (
    <NativeTabs
      hidden={isTabBarHidden}
      iconColor={{ default: booksTabColor, selected: booksTabColor }}
      labelStyle={{
        default: { color: booksTabColor },
        selected: { color: booksTabColor },
      }}
      screenListeners={({ route }) => ({
        tabPress: () => {
          if (route.name === '(library)' && pathname === '/') {
            toggleDisplayMode();
          }
          // Excerpts Tab Core E：复用书库已验证的 current-tab re-tap 机制。
          // tabPress 触发时 pathname 还没变（仍是旧路由）：从其他 Tab 第一次
          // 进入摘录时 pathname !== '/excerpts'，不 toggle；已经在摘录页时
          // pathname === '/excerpts'，才是 re-tap，切换 按时间/按书籍。
          if (route.name === 'excerpts' && pathname === '/excerpts') {
            toggleViewMode();
          }
        },
      })}
    >
      <NativeTabs.Trigger name="(library)" disablePopToTop disableScrollToTop>
        <NativeTabs.Trigger.Icon sf="books.vertical" />
        <NativeTabs.Trigger.Label>{uiText.tabs.library}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="data">
        <NativeTabs.Trigger.Icon sf="chart.bar.xaxis.descending" />
        <NativeTabs.Trigger.Label>{uiText.tabs.data}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="excerpts">
        <NativeTabs.Trigger.Icon sf="text.bubble" />
        <NativeTabs.Trigger.Label>{uiText.tabs.excerpts}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
