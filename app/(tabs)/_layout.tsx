import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePathname } from 'expo-router';

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
  const { toggleDisplayMode } = useLibraryView();

  return (
    <NativeTabs
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
        <NativeTabs.Trigger.Icon sf="chart.bar.xaxis" />
        <NativeTabs.Trigger.Label>数据</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="excerpts">
        <NativeTabs.Trigger.Icon sf="quote.bubble" />
        <NativeTabs.Trigger.Label>摘录</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
