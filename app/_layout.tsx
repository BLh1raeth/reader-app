import { Stack } from 'expo-router';
import { DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';

import { tokens } from '../src/design-system/tokens';

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
      <Stack screenOptions={{ contentStyle: { backgroundColor: tokens.colors.background } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="reader/[bookId]" options={{ title: 'Reader' }} />
      </Stack>
    </ThemeProvider>
  );
}
