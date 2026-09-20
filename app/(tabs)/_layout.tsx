import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePathname } from 'expo-router';
import { PlatformColor } from 'react-native';

import { LibraryViewProvider, useLibraryView } from '../../src/features/library/library-view-context';
import { uiText } from '../../src/localization';

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
      {/* SPIKE-ONLY: temporary native popover feasibility test tab. Remove after the spike. */}
      <NativeTabs.Trigger name="dev-popover-spike">
        <NativeTabs.Trigger.Icon sf="flask" />
        <NativeTabs.Trigger.Label>Spike</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
