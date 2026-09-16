import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import { listVisits } from '@/db/repos/visits';
import { formatVisitDate } from '@/lib/journal/history';
import { useLocalOwner } from '@/lib/account/owner-store';
import { captureFileUri } from '@/lib/files/photos';

export function WallPhotoPicker({ savedId, selectedId, onSelect }: { savedId: string; selectedId?: string; onSelect: (id: string) => void }) {
  const owner = useLocalOwner();
  const { data } = useLiveQuery(selectArtworkPhotos(savedId, owner), [savedId, owner]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  return <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{data.filter((photo) => photo.owner === owner).map((photo, index) => {
    const visit = visits.data.find((visit) => visit.owner === owner && visit.localId === photo.visitLocalId);
    const kind = photo.kind === 'full' ? 'Full painting' : photo.kind === 'detail' ? 'Detail' : 'Wall label';
    return <Pressable key={photo.localId}
      accessibilityRole="button" accessibilityLabel={`Use ${photo.kind} photo ${index + 1} on wall`} accessibilityState={{ selected: photo.localId === selectedId }} onPress={() => onSelect(photo.localId)}
      style={{ width: '47%', padding: 8, gap: 6, borderWidth: 2, borderColor: photo.localId === selectedId ? Gallery.accent : Gallery.separator, borderRadius: 8 }}>
      <View style={{ width: '100%', aspectRatio: 1, backgroundColor: Gallery.fill }}>{photo.path && <Image source={{ uri: captureFileUri(photo.path) }} style={{ width: '100%', height: '100%' }} contentFit="contain" />}</View>
      <Text numberOfLines={2} style={{ color: Gallery.ink, fontSize: 12, fontWeight: '500' }}>{photo.caption || kind}{photo.localId === selectedId ? ' ✓' : ''}</Text>
      <Text style={{ color: Gallery.muted, fontSize: 10, lineHeight: 15 }}>{visit ? formatVisitDate(visit.visitedOn) : 'Not linked to a visit'} · {kind}</Text>
    </Pressable>;
  })}</ScrollView>;
}
