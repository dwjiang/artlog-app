import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Gallery, Spacing } from '@/constants/theme';
import { addBreadcrumb, reportError } from '@/lib/observability';

export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => { reportError(error, 'app.render'); }, [error]);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.screen} contentContainerStyle={styles.content}>
    <ThemedText type="subtitle" accessibilityRole="alert">Artlog could not open this screen</ThemedText>
    <ThemedText>Try opening it again. Your saved collection is still on this phone.</ThemedText>
    <GalleryButton label="Retry" onPress={() => {
      addBreadcrumb('app.render.retry');
      void retry().catch((cause: unknown) => reportError(cause, 'app.render.retry'));
    }} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  content: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.two },
});
