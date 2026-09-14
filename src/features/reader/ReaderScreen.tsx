import { Stack, useLocalSearchParams } from 'expo-router';
import { PlatformColor, StyleSheet, Text } from 'react-native';

import { PlaceholderScreen } from '../../components/PlaceholderScreen';
import { tokens } from '../../design-system/tokens';

export default function ReaderScreen() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Reader' }} />
      <PlaceholderScreen title="Reader" edges={['left', 'right', 'bottom']}>
        <Text style={styles.bookId}>Book ID: {bookId}</Text>
      </PlaceholderScreen>
    </>
  );
}

const styles = StyleSheet.create({
  bookId: {
    color: PlatformColor('secondaryLabel'),
    fontSize: tokens.typography.body,
  },
});
