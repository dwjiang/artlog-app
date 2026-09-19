import { router } from 'expo-router';
import { GalleryButton } from '@/components/collection/gallery-button';
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
          <GalleryButton label={saveLabel} variant="filled" fullWidth busy={saving} busyLabel="Saving…" disabled={!canSave || saving} onPress={onSave} />
          {!canSave && <ThemedText type="small" themeColor="textSecondary">Shorten these details to save this work.</ThemedText>}
          {error && <ThemedText type="small" themeColor="error" accessibilityRole="alert">{error}</ThemedText>}
          {onLabel && <GalleryButton label={LABEL_BUTTON} variant="outlined" fullWidth disabled={saving} onPress={onLabel} />}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: Spacing.two },
  saved: { minHeight: 44, justifyContent: 'center', paddingVertical: Spacing.two },
});
