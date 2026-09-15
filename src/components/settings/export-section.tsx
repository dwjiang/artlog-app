import { Button, Host } from '@expo/ui';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listNotes } from '@/db/repos/notes';
import { listSavedWorks } from '@/db/repos/saved-works';
import { listVisits } from '@/db/repos/visits';
import { captureOwner } from '@/lib/account/owner-store';
import { buildExport } from '@/lib/export/build-export';

export function ExportSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);

  async function exportCollection() {
    if (inFlight.current) return;
    const current = captureOwner();
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable');
      const [works, visits, notes] = await Promise.all([listSavedWorks({}, current.owner), listVisits(current.owner), listNotes(current.owner)]);
      if (!current.isCurrent()) return;
      const data = buildExport({ works, visits, notes });
      const file = new File(Paths.cache, `artlog-export-${data.exportedAt.replace(/[:.]/g, '-')}.json`);
      file.write(JSON.stringify(data, null, 2));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Export collection' });
    } catch { setError("Couldn't export your collection. Try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <View style={{ gap: Spacing.two }}>
    <Host matchContents colorScheme="light">
      <Button label={busy ? 'Exporting…' : 'Export collection as JSON'} disabled={busy} onPress={() => { void exportCollection(); }} />
    </Host>
    <ThemedText type="small" themeColor="textSecondary">Includes saved works, visits and notes. Photo files aren’t included in this export.</ThemedText>
    {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
  </View>;
}
