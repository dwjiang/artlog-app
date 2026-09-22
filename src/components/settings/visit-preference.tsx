import { reportError } from '@/lib/observability';
import { Switch } from '@expo/ui';
import { useEffect, useState } from 'react';
import { GroupedFooter, GroupedSection, ValueRow } from '@/components/grouped-list';
import { getSetting, setSetting } from '@/db/repos/settings';
import { captureOwner, useLocalOwner } from '@/lib/account/owner-store';

export function VisitPreference() { return <OwnedPreference key={useLocalOwner()} />; }
function OwnedPreference() {
  const owner = useLocalOwner();
  const [remember, setRemember] = useState(true), [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void getSetting(`remember-visit-view:${owner}`).then((value) => { if (active) setRemember(value !== 'false'); })
      .catch((cause) => { reportError(cause, 'settings.visit-view.load'); if (active) setError('The preference could not load.'); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [owner]);
  async function change(value: boolean) {
    const session = captureOwner(); setSaving(true); setError(undefined);
    try { await setSetting(`remember-visit-view:${owner}`, String(value)); if (session.isCurrent()) setRemember(value); }
    catch (cause) { reportError(cause, 'settings.visit-view.save'); if (session.isCurrent()) setError('The preference could not be saved.'); }
    finally { if (session.isCurrent()) setSaving(false); }
  }
  // The switch stays mounted while a change saves: unmounting it cuts the toggle animation and drops VoiceOver focus.
  return <GroupedSection footer={<GroupedFooter tone={error ? 'destructive' : 'muted'}>{error ?? 'Open Visits in your last List or Globe view. When off, new sessions start with the globe.'}</GroupedFooter>}>
    {!loaded ? <ValueRow label="Remember visit view" loading /> : <Switch label="Remember visit view" value={remember} disabled={saving} onValueChange={(value) => { void change(value); }} />}
  </GroupedSection>;
}
