import { Button } from 'react-native';
import { useRouter } from 'expo-router';

import { PlaceholderScreen } from '../../components/PlaceholderScreen';

export default function LibraryScreen() {
  const router = useRouter();

  return (
    <PlaceholderScreen title="书库">
      <Button
        title="Open Reader"
        onPress={() =>
          router.push({
            pathname: '/reader/[bookId]',
            params: { bookId: 'demo-book' },
          })
        }
      />
    </PlaceholderScreen>
  );
}
