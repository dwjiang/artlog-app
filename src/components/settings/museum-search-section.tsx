import { reportError } from '@/lib/observability';
import { Host, Switch } from '@expo/ui';
import { useState } from 'react';

import { View } from 'react-native';
import { ThemedText } from '../themed-text';
import { Gallery } from '@/constants/theme';
import { LoadingRing } from '@/components/loading-ring';
import { SEARCH_CONSENT_BODY } from '@/components/scan/result/search-consent-sheet';
import { useScreenActive } from '@/hooks/use-screen-active';
import { setMuseumSearchConsent } from '@/lib/settings/museum-search';
import { useMuseumSearchConsent } from '@/lib/settings/use-museum-search-consent';

export const MUSEUM_SEARCH_SETTING = 'Search museum sites for my scans';

/** Turning the switch on asks the owner to present the consent sheet; consent itself is stored by that sheet. */
export function MuseumSearchSection({ onRequestConsent }: { onRequestConsent: () => void }) {
  const { consent, failed } = useMuseumSearchConsent(useScreenActive());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const footer = error ?? (failed ? "Couldn't read your choice. Reopen Settings to try again." : undefined);

  async function change(enabled: boolean) {
    setError(undefined);
    if (enabled) { onRequestConsent(); return; }
    setSaving(true);
    try {
      await setMuseumSearchConsent('declined');
    } catch (cause) {
      reportError(cause, 'settings.museum-search.save');
      setError("Couldn't save your choice. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <View style={{ padding: 16, gap: 10, backgroundColor: Gallery.fill, borderRadius: 8 }}><Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: '100%' }}>
    {consent === undefined && !failed ? <LoadingRing accessibilityLabel={`Loading ${MUSEUM_SEARCH_SETTING.toLowerCase()}`} /> : <Switch label={MUSEUM_SEARCH_SETTING} value={consent === 'granted'} disabled={saving || failed}
      onValueChange={(value) => { void change(value); }} />}
  </Host><ThemedText type="small" themeColor="textSecondary">{SEARCH_CONSENT_BODY}</ThemedText>
    {footer && <ThemedText type="small" themeColor="error" accessibilityRole="alert">{footer}</ThemedText>}
  </View>;
}
