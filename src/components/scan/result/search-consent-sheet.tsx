import { BottomSheet, RNHostView } from '@expo/ui';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Gallery, Spacing } from '@/constants/theme';
import { setMuseumSearchConsent } from '@/lib/settings/museum-search';

export const SEARCH_CONSENT_TITLE = "Look in the museum’s collection?";

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
    <BottomSheet contentPadding={0} snapPoints={['full']} containerColor={Colors.light.background} isPresented={open} onDismiss={() => { if (!pending.current) onDismiss(); }}>
      <RNHostView>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <ThemedText variant="display">{SEARCH_CONSENT_TITLE}</ThemedText>
          <ThemedText>We’ll search the museum’s current exhibitions and compare its images with your photo on this phone.</ThemedText>
          <ThemedText>If we don’t find a match, we’ll send a copy of your photo to a vision model and search the museum’s collection using its description.</ThemedText>
          <View style={{ padding: 16, backgroundColor: Gallery.fill, borderRadius: 8 }}><ThemedText type="small">The photo isn’t stored by this search. You can turn this off in Settings.</ThemedText></View>
          {error && <ThemedText accessibilityRole="alert" themeColor="error">{error}</ThemedText>}
          <GalleryButton label="Search this museum" variant="filled" fullWidth busy={saving} disabled={saving} onPress={() => { void grant(); }} />
          <GalleryButton label="Not now" fullWidth disabled={saving} onPress={onDismiss} />
        </ScrollView>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.content, paddingBottom: Spacing.six },
});
