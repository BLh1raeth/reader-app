import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePathname } from 'expo-router';
import { PlatformColor } from 'react-native';

import { LibraryViewProvider, useLibraryView } from '../../src/features/library/library-view-context';

export default function TabLayout() {
  return (
    <LibraryViewProvider>
      <AppTabs />
    </LibraryViewProvider>
  );
}

function AppTabs() {
  const pathname = usePathname();
  const { isTabBarHidden, toggleDisplayMode } = useLibraryView();
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
        },
      })}
    >
      <NativeTabs.Trigger name="(library)" disablePopToTop disableScrollToTop>
        <NativeTabs.Trigger.Icon sf="books.vertical" />
        <NativeTabs.Trigger.Label>书库</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="data">
        <NativeTabs.Trigger.Icon sf="chart.xyaxis.line" />
        <NativeTabs.Trigger.Label>数据</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="excerpts">
        <NativeTabs.Trigger.Icon sf="quote.opening" />
        <NativeTabs.Trigger.Label>摘录</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
