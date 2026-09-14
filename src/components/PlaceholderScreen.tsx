import type { ReactNode } from 'react';
import { PlatformColor, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { tokens } from '../design-system/tokens';

type PlaceholderScreenProps = {
  title: string;
  children?: ReactNode;
  edges?: Edge[];
};

const defaultEdges: Edge[] = ['top', 'left', 'right'];

export function PlaceholderScreen({
  title,
  children,
  edges = defaultEdges,
}: PlaceholderScreenProps) {
  return (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {children ? <View style={styles.body}>{children}</View> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: PlatformColor('systemBackground'),
  },
  content: {
    flex: 1,
    paddingHorizontal: tokens.spacing.screen,
  },
  title: {
    color: PlatformColor('label'),
    fontSize: tokens.typography.largeTitle,
    fontWeight: '700',
    letterSpacing: 0.37,
  },
  body: {
    marginTop: tokens.spacing.section,
  },
});
