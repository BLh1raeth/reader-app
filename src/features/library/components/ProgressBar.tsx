import { View } from 'react-native';

import { styles } from './library-styles';

export function ProgressBar({ progress }: { progress: number }) {
  return (
    <View accessibilityLabel={`阅读进度 ${progress}%`} accessibilityRole="progressbar" style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${progress}%` }]} />
    </View>
  );
}
