import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { listVisits } from '@/db/repos/visits';
import { useLocalOwner } from '@/lib/account/owner-store';
import { updatePhotoSession } from '@/lib/capture/photo-draft';
import { setCaptureVisit } from '@/lib/capture/visit-context';
import { formatVisitDate } from '@/lib/journal/history';
import { GalleryButton } from '../collection/gallery-button';
export function CaptureContextScreen() {
  const owner = useLocalOwner();
  const { draftId } = useLocalSearchParams<{ draftId?: string }>();
  const visits = useLiveQuery(listVisits(owner), [owner]);
  async function choose(value: string) {
    if (draftId) updatePhotoSession(owner, draftId, { visitLocalId: value === 'none' ? null : value });
    else await setCaptureVisit(value, owner);
    router.back();
  }
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 14 }}>
    <Stack.Screen options={{ title: 'Save this moment to…' }} />
    <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 20 }}>{draftId ? 'New photos use this visit. Earlier photos and encounters stay where they are.' : 'Choose the visit for your next captures. Photos retain their capture date.'}</Text>
    {!draftId && <GalleryButton label="Current museum visit" icon="location" onPress={() => { void choose('auto'); }} />}
    <GalleryButton label="No visit · Save artwork only" icon="photo" onPress={() => { void choose('none'); }} />
    <GalleryButton label="Create a visit" icon="plus" onPress={() => router.push('/visit-create')} />
    <Text style={{ fontSize: 11, letterSpacing: 1, color: Gallery.muted, paddingTop: 12 }}>YOUR VISITS</Text>
    {visits.data.filter((visit) => visit.owner === owner).map((visit) => <View key={visit.localId} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator }}>
      <GalleryButton label={`${visit.venueName} · ${formatVisitDate(visit.visitedOn)}`} onPress={() => { void choose(visit.localId); }} />
    </View>)}
  </ScrollView>;
}
