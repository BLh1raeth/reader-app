import { Stack } from 'expo-router';
import { DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';

import { tokens } from '../src/design-system/tokens';
import ReaderDomPrewarm from '../src/features/reader/ReaderDomPrewarm';

const appTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: tokens.colors.background,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={appTheme}>
      <StatusBar style="auto" />
      {/* Hidden pre-warmed reader WebView: pays the WKWebView cold-start
          cost at app launch so book opens don't pay it serially after tap. */}
      <ReaderDomPrewarm />
      <Stack screenOptions={{ contentStyle: { backgroundColor: tokens.colors.background } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="reader/[bookId]" options={{ animation: 'none', gestureEnabled: false, headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
