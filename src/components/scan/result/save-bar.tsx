import { router } from 'expo-router';
import { GalleryButton } from '@/components/collection/gallery-button';
import { Button, Host } from '@expo/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// Product voice: the label is the fastest route to an exact answer.
export const LABEL_BUTTON = 'Get the exact answer — point at the label';

export type SaveBarProps = {
  saveLabel?: string;
  canSave: boolean;
  saving: boolean;
  savedId?: string;
  error?: string;
  onSave: () => void;
  /** Offered while the card is not confident; the bar shows no label button without it. */
  onLabel?: () => void;
  onViewSaved: () => void;
};

export function SaveBar({ saveLabel = 'Save to collection', canSave, saving, savedId, error, onSave, onLabel, onViewSaved }: SaveBarProps) {
  return (
    <View style={styles.bar}>
      {savedId ? (
        <View style={{ gap: 12 }}><ThemedText type="title">Added to your collection.</ThemedText><Pressable accessibilityRole="link" onPress={onViewSaved} style={styles.saved}>
          <ThemedText themeColor="accent">View artwork</ThemedText>
        </Pressable><GalleryButton label="Scan next artwork" variant="filled" fullWidth onPress={() => { router.dismissAll(); router.navigate('/(tabs)/(scan)/scan'); }} /></View>
      ) : (
        <>
          <Host matchContents colorScheme="light">
            <Button label={saving ? 'Saving…' : saveLabel} disabled={!canSave || saving} onPress={onSave} />
          </Host>
          {!canSave && <ThemedText type="small" themeColor="textSecondary">Shorten these details to save this work.</ThemedText>}
          {error && <ThemedText type="small">{error}</ThemedText>}
          {onLabel && (
            <Host matchContents colorScheme="light">
              <Button variant="outlined" label={LABEL_BUTTON} disabled={saving} onPress={onLabel} />
            </Host>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: Spacing.two },
  saved: { paddingVertical: Spacing.two },
});
