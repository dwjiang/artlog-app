import { Host, Switch } from '@expo/ui';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getSetting, setSetting } from '@/db/repos/settings';
import { captureOwner, useLocalOwner } from '@/lib/account/owner-store';
import { Gallery } from '@/constants/theme';

export function VisitPreference() { return <OwnedPreference key={useLocalOwner()} />; }
function OwnedPreference() {
  const owner = useLocalOwner();
  const [remember, setRemember] = useState(true), [busy, setBusy] = useState(true), [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void getSetting(`remember-visit-view:${owner}`).then((value) => { if (active) setRemember(value !== 'false'); })
      .catch(() => { if (active) setError('The preference could not load.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [owner]);
  async function change(value: boolean) {
    const session = captureOwner(); setBusy(true); setError(undefined);
    try { await setSetting(`remember-visit-view:${owner}`, String(value)); if (session.isCurrent()) setRemember(value); }
    catch { if (session.isCurrent()) setError('The preference could not be saved.'); }
    finally { if (session.isCurrent()) setBusy(false); }
  }
  return <View style={{ gap: 8 }}><Host matchContents={{ vertical: true }} colorScheme="light" seedColor={Gallery.accent}>
    <Switch label="Remember visit view" value={remember} disabled={busy} onValueChange={(value) => { void change(value); }} />
  </Host><Text style={{ fontSize: 12, lineHeight: 18, color: Gallery.muted }}>Open Visits in your last List or Globe view. When off, new sessions start with the globe.</Text>
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
  </View>;
}
