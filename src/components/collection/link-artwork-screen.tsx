import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { linkArtworkVisit, selectArtworkEncounters } from '@/db/repos/artwork-album';
import { listSavedWorks } from '@/db/repos/saved-works';
import { listVisits } from '@/db/repos/visits';
import { useLocalOwner } from '@/lib/account/owner-store';
import { formatVisitDate } from '@/lib/journal/history';
import { GalleryButton } from './gallery-button';

export function LinkArtworkScreen() {
  const { savedId, visitId } = useLocalSearchParams<{ savedId?: string; visitId?: string }>();
  const owner = useLocalOwner();
  const works = useLiveQuery(listSavedWorks(owner), [owner]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const [error, setError] = useState<string>();
  const rows = savedId ? visits.data.filter((row) => row.owner === owner).map((row) => ({ id: row.localId, title: row.venueName, subtitle: formatVisitDate(row.visitedOn) }))
    : works.data.filter((row) => row.owner === owner).map((row) => ({ id: row.localId, title: row.title, subtitle: row.artist }));
  return <ScrollView style={{ backgroundColor: Gallery.paper }} contentContainerStyle={{ padding: 20, gap: 10 }}>
    <Stack.Screen options={{ title: savedId ? 'Link a visit' : 'Link an artwork' }} />
    <Text style={{ color: Gallery.muted, fontSize: 13, marginBottom: 12 }}>Keep the artwork and its photos together across visits.</Text>
    {rows.map((row) => {
      const work = savedId ?? row.id, visit = visitId ?? row.id;
      const linked = encounters.data.some((entry) => entry.owner === owner && entry.savedLocalId === work && entry.visitLocalId === visit);
      return <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${linked ? 'Linked: ' : 'Link '}${row.title}`} disabled={linked}
        onPress={() => { try { linkArtworkVisit(work, visit, owner); router.back(); } catch { setError('Could not link this visit. Try again.'); } }}
        style={{ padding: 16, backgroundColor: Gallery.fill, borderRadius: 12, gap: 5, opacity: linked ? 0.5 : 1 }}>
        <Text style={{ fontSize: 16, color: Gallery.ink }}>{row.title}</Text><Text style={{ fontSize: 12, color: Gallery.muted }}>{row.subtitle}{linked ? ' · Linked' : ''}</Text>
      </Pressable>;
    })}
    {!rows.length && <View style={{ gap: 10 }}><Text style={{ color: Gallery.muted }}>{savedId ? 'Add a visit to link this artwork.' : 'Save an artwork before linking it to this visit.'}</Text>
      {savedId && <GalleryButton label="Add visit" icon="plus" onPress={() => router.push('/visit-create')} />}</View>}
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
  </ScrollView>;
}
