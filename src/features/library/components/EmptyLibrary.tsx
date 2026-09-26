import { Pressable, Text, View } from 'react-native';

import { styles } from './library-styles';

export function EmptyLibrary({ onImport }: { onImport: () => void }) {
  return (
    <View style={styles.emptyState}>
      <Text accessibilityLabel="书本" style={styles.emptySymbol}>▤</Text>
      <Text selectable style={styles.emptyTitle}>书库还是空的</Text>
      <Text selectable style={styles.emptyDescription}>导入一本书开始阅读</Text>
      <Pressable accessibilityRole="button" onPress={onImport} style={styles.importButton}><Text style={styles.importButtonText}>导入图书</Text></Pressable>
    </View>
  );
}
