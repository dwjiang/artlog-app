import { Button, Host } from '@expo/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export function CameraPermission({ children }: { children: ReactNode }) {
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (canRequestPermission) {
      void requestPermission().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not request camera access.');
      });
    }
  }, [canRequestPermission, requestPermission]);

  if (hasPermission) return children;
  return (
    <View style={styles.content}>
      <ThemedText type="subtitle">Identify a painting</ThemedText>
      <ThemedText themeColor="textSecondary">
        Allow camera access to scan a painting, or import a photo from your library.
      </ThemedText>
      {!canRequestPermission && (
        <Host matchContents colorScheme="light">
          <Button label="Open Settings" onPress={() => {
            void Linking.openSettings().catch(() => setError('Could not open Settings.'));
          }} />
        </Host>
      )}
      {error && <ThemedText selectable>{error}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
});
