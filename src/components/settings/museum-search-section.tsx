import { Host, Switch } from '@expo/ui';
import { useState } from 'react';

import { View } from 'react-native';
import { ThemedText } from '../themed-text';
import { Gallery } from '@/constants/theme';
import { useScreenActive } from '@/hooks/use-screen-active';
import { setMuseumSearchConsent } from '@/lib/settings/museum-search';
import { useMuseumSearchConsent } from '@/lib/settings/use-museum-search-consent';

export const MUSEUM_SEARCH_SETTING = 'Search museum sites with my photo';

/** Turning the switch on asks the owner to present the consent sheet; consent itself is stored by that sheet. */
export function MuseumSearchSection({ onRequestConsent }: { onRequestConsent: () => void }) {
  const consent = useMuseumSearchConsent(useScreenActive());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function change(enabled: boolean) {
    setError(undefined);
    if (enabled) { onRequestConsent(); return; }
    setSaving(true);
    try {
      await setMuseumSearchConsent('declined');
    } catch {
      setError("Couldn't save your choice. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <View style={{ padding: 16, gap: 10, backgroundColor: Gallery.fill, borderRadius: 8 }}><Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: '100%' }}>
    <Switch label={MUSEUM_SEARCH_SETTING} value={consent === 'granted'} disabled={consent === undefined || saving}
      onValueChange={(value) => { void change(value); }} />
  </Host><ThemedText type="small" themeColor="textSecondary">Use museum websites to help identify artworks. You’ll review what is shared before turning this on.</ThemedText>
    {error && <ThemedText type="small" themeColor="error" accessibilityRole="alert">{error}</ThemedText>}
  </View>;
}
