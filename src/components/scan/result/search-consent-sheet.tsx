import { BottomSheet } from '@expo/ui';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { setMuseumSearchConsent } from '@/lib/settings/museum-search';

export const SEARCH_CONSENT_TITLE = "Search this museum's collection?";
export const SEARCH_CONSENT_BODY = "We'll search the museum's current exhibitions and compare its images with your photo on this phone. If we don't find a match, we'll send a copy of your photo to a vision model and search the museum's collection using its description. The photo isn't stored by this search. You can turn this off in Settings.";

type Props = { open: boolean; onGranted: () => void; onDismiss: () => void };

export function SearchConsentSheet({ open, onGranted, onDismiss }: Props) {
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function grant() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await setMuseumSearchConsent('granted');
      onGranted();
    } catch {
      setError("Couldn't save your choice. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <BottomSheet isPresented={open} onDismiss={() => { if (!pending.current) onDismiss(); }}>
      <View style={styles.content}>
        <ThemedText type="subtitle">{SEARCH_CONSENT_TITLE}</ThemedText>
        <ThemedText>{SEARCH_CONSENT_BODY}</ThemedText>
        {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        <GalleryButton label="Search" variant="filled" fullWidth disabled={saving} onPress={() => { void grant(); }} />
        <GalleryButton label="Not now" variant="outlined" fullWidth disabled={saving} onPress={onDismiss} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({ content: { gap: Spacing.three, paddingBottom: Spacing.four } });
