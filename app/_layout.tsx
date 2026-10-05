import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';

import { tokens } from '../src/design-system/tokens';
import ReaderDomPrewarm from '../src/features/reader/ReaderDomPrewarm';
import { useAppAppearance } from '../src/design-system/use-app-appearance';

export default function RootLayout() {
  const scheme = useAppAppearance();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const appTheme = { ...base, colors: { ...base.colors, background: scheme === 'dark' ? '#000000' : '#F3F2F8' } };
  return (
    <ThemeProvider value={appTheme}>
      <StatusBar style="auto" />
      {/* Hidden pre-warmed reader WebView: pays the WKWebView cold-start
          cost at app launch so book opens don't pay it serially after tap. */}
      <ReaderDomPrewarm />
      <Stack screenOptions={{ contentStyle: { backgroundColor: tokens.colors.background } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="reader/[bookId]" options={{ animation: 'none', gestureEnabled: false, headerShown: false }} />
        <Stack.Screen name="data/[dayKey]" options={{ headerShown: false }} />
        <Stack.Screen name="data/metric/[metric]" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
