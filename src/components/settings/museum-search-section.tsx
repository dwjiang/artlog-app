import { Host, Switch } from '@expo/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SEARCH_CONSENT_BODY, SearchConsentSheet } from '@/components/scan/result/search-consent-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useScreenActive } from '@/hooks/use-screen-active';
import { setMuseumSearchConsent } from '@/lib/settings/museum-search';
import { useMuseumSearchConsent } from '@/lib/settings/use-museum-search-consent';

export const MUSEUM_SEARCH_SETTING = 'Search museum sites with my photo';

export function MuseumSearchSection() {
  const consent = useMuseumSearchConsent(useScreenActive());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function change(enabled: boolean) {
    setError(undefined);
    if (enabled) { setOpen(true); return; }
    setSaving(true);
    try {
      await setMuseumSearchConsent('declined');
    } catch {
      setError("Couldn't save your choice. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <Host matchContents colorScheme="light">
        <Switch label={MUSEUM_SEARCH_SETTING} value={consent === 'granted'} disabled={consent === undefined || saving}
          onValueChange={(value) => { void change(value); }} />
      </Host>
      <ThemedText type="small" themeColor="textSecondary">{SEARCH_CONSENT_BODY}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <SearchConsentSheet open={open} onGranted={() => setOpen(false)} onDismiss={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({ section: { gap: Spacing.two } });
