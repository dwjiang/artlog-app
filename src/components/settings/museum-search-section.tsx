import { Switch } from '@expo/ui';
import { useState } from 'react';

import { GroupedFooter, GroupedSection } from '@/components/grouped-list';
import { SEARCH_CONSENT_BODY } from '@/components/scan/result/search-consent-sheet';
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

  return <GroupedSection footer={<GroupedFooter tone={error ? 'destructive' : 'muted'}>{error ?? SEARCH_CONSENT_BODY}</GroupedFooter>}>
    <Switch label={MUSEUM_SEARCH_SETTING} value={consent === 'granted'} disabled={consent === undefined || saving}
      onValueChange={(value) => { void change(value); }} />
  </GroupedSection>;
}
