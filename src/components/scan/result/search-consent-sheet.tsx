import { BottomSheet, Button, Host } from '@expo/ui';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { setMuseumSearchConsent } from '@/lib/settings/museum-search';

export const SEARCH_CONSENT_TITLE = "Search this museum's collection?";
export const SEARCH_CONSENT_BODY = "We'll send a copy of your photo of the painting to a vision model that describes what it shows, then search the museum's website for a match. The photo isn't stored. You can turn this off in Settings.";

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
        <Host matchContents colorScheme="light">
          <Button label="Search" disabled={saving} onPress={() => { void grant(); }} />
        </Host>
        <Host matchContents colorScheme="light">
          <Button variant="outlined" label="Not now" disabled={saving} onPress={onDismiss} />
        </Host>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({ content: { gap: Spacing.three, paddingBottom: Spacing.four } });
