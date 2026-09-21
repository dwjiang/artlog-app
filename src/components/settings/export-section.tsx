import { router } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';

import { ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText as Text } from '../themed-text';
import { EmptyPaper } from '../empty-state-art';
import { GalleryButton } from '../collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { listNotes } from '@/db/repos/notes';
import { listSavedWorks } from '@/db/repos/saved-works';
import { listVisits } from '@/db/repos/visits';
import { captureOwner, useLocalOwner } from '@/lib/account/owner-store';
import { buildExport } from '@/lib/export/build-export';

export function ExportSection() {
  return <OwnedExport key={useLocalOwner()} />;
}

function OwnedExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState<{ uri: string; name: string }>();
  const inFlight = useRef(false);

  async function exportCollection() {
    if (inFlight.current) return;
    const current = captureOwner();
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable');
      const [works, visits, notes] = await Promise.all([listSavedWorks(current.owner), listVisits(current.owner), listNotes(current.owner)]);
      if (!current.isCurrent()) return;
      const data = buildExport({ works, visits, notes });
      const file = new File(Paths.cache, `artlog-export-${data.exportedAt.replace(/[:.]/g, '-')}.json`);
      file.write(JSON.stringify(data, null, 2));
      if (current.isCurrent()) setReady({ uri: file.uri, name: file.name });
    } catch { setError("Couldn't export your collection. Try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function share() {
    if (!ready || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try { await Sharing.shareAsync(ready.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Export collection' }); }
    catch { setError("Couldn't share your export. Your file is ready; try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, padding: 20, gap: 24 }}>
    {ready ? <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: Gallery.highlight, alignItems: 'center', justifyContent: 'center', marginTop: 24 }}><Image source="sf:checkmark" tintColor={Gallery.ink} style={{ width: 28, height: 28 }} /></View> : <EmptyPaper kind="note" />}
    <View style={{ gap: 12 }}>{ready && <Text variant="pageTitle">Export ready.</Text>}
      <Text style={{ color: Gallery.muted, fontSize: 15, lineHeight: 23 }}>{ready ? 'Save a copy or send it somewhere you choose. Nothing has been shared yet.' : 'Export your saved artworks, museum visits and notes as one file.'}</Text></View>
    {ready ? <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, borderWidth: 1, borderColor: Gallery.softBorder }}>
      <Image source="sf:doc.text" tintColor={Gallery.accent} style={{ width: 28, height: 32 }} /><View style={{ flex: 1, gap: 4 }}><Text style={{ fontWeight: '600' }}>Artlog journal</Text><Text selectable numberOfLines={2} style={{ fontSize: 12, lineHeight: 18, color: Gallery.muted }}>{ready.name}</Text></View>
    </View> : <Text style={{ fontSize: 14, lineHeight: 22, color: Gallery.muted }}>Artworks, visits and notes are included. Photo files aren’t included.</Text>}
    <View style={{ flexGrow: 1 }} />
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
    <View style={{ gap: 8 }}><GalleryButton label={ready ? 'Share file' : 'Export collection as JSON'} icon="square.and.arrow.up" variant="filled" fullWidth busy={busy} busyLabel={ready ? 'Sharing…' : 'Preparing export…'} disabled={busy} onPress={() => { void (ready ? share() : exportCollection()); }} />
      {ready ? <GalleryButton label="Done" fullWidth disabled={busy} onPress={() => router.back()} /> : <Text style={{ color: Gallery.muted, fontSize: 12, lineHeight: 18 }}>Preparing a file doesn’t send it anywhere.</Text>}</View>
  </ScrollView>;
}
