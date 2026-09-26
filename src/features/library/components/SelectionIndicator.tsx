import { View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { styles } from './library-styles';

export function SelectionIndicator({ compact = false, selected }: { compact?: boolean; selected: boolean }) {
  return (
    <View style={[styles.selectionIndicator, compact ? styles.selectionIndicatorCompact : null, selected ? styles.selectionIndicatorSelected : null]}>
      {selected ? <SymbolView name="checkmark" size={compact ? 13 : 15} tintColor="#FFFFFF" weight="bold" /> : null}
    </View>
  );
}
