import { useEffect, useState, type ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useScreenActive } from '@/hooks/use-screen-active';

export function CameraPermission({ children }: { children: ReactNode }) {
  const active = useScreenActive();
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (active && canRequestPermission) {
      void requestPermission().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not request camera access.');
      });
    }
  }, [active, canRequestPermission, requestPermission]);

  if (hasPermission) return children;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <ThemedText type="subtitle">Camera access needed</ThemedText>
      <ThemedText themeColor="textSecondary">
        Allow camera access to scan a painting, or import a photo from your library.
      </ThemedText>
      {!canRequestPermission && <GalleryButton label="Open Settings" variant="outlined" onPress={() => {
        void Linking.openSettings().catch(() => setError('Could not open Settings.'));
      }} />}
      {error && <ThemedText selectable themeColor="error" accessibilityRole="alert">{error}</ThemedText>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: Spacing.content, gap: Spacing.three },
});
