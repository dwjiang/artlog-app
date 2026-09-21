import { Switch } from '@expo/ui';
import { useState } from 'react';

import { GroupedFooter, GroupedSection, ValueRow } from '@/components/grouped-list';
import { SEARCH_CONSENT_BODY } from '@/components/scan/result/search-consent-sheet';
import { useScreenActive } from '@/hooks/use-screen-active';
import { setMuseumSearchConsent } from '@/lib/settings/museum-search';
import { useMuseumSearchConsent } from '@/lib/settings/use-museum-search-consent';

export const MUSEUM_SEARCH_SETTING = 'Search museum sites with my photo';

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
    } catch {
      setError("Couldn't save your choice. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <GroupedSection footer={<GroupedFooter tone={footer ? 'destructive' : 'muted'}>{footer ?? SEARCH_CONSENT_BODY}</GroupedFooter>}>
    {consent === undefined && !failed ? <ValueRow label={MUSEUM_SEARCH_SETTING} loading /> : <Switch label={MUSEUM_SEARCH_SETTING} value={consent === 'granted'} disabled={saving || failed}
      onValueChange={(value) => { void change(value); }} />}
  </GroupedSection>;
}
