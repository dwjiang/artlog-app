import { ThemedText as Text } from '@/components/themed-text';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import { listVisits } from '@/db/repos/visits';
import { formatVisitDate } from '@/lib/journal/history';
import { useLocalOwner } from '@/lib/account/owner-store';
import { captureFileUri } from '@/lib/files/photos';

export function WallPhotoPicker({ savedId, selectedId, onSelect }: { savedId: string; selectedId?: string; onSelect: (id: string) => void }) {
  const owner = useLocalOwner();
  const { fontScale } = useWindowDimensions();
  const { data } = useLiveQuery(selectArtworkPhotos(savedId, owner), [savedId, owner]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  return <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{data.filter((photo) => photo.owner === owner).map((photo, index) => {
    const visit = visits.data.find((visit) => visit.owner === owner && visit.localId === photo.visitLocalId);
    const kind = photo.kind === 'full' ? 'Full painting' : photo.kind === 'detail' ? 'Detail' : 'Wall label';
    return <Pressable key={photo.localId}
      accessibilityRole="button" accessibilityLabel={`Use ${photo.kind} photo ${index + 1} on wall`} accessibilityState={{ selected: photo.localId === selectedId }} onPress={() => onSelect(photo.localId)}
      style={{ width: fontScale >= 1.6 ? '100%' : '47%', padding: 8, gap: 6, borderWidth: 2, borderColor: photo.localId === selectedId ? Gallery.ink : Gallery.separator, backgroundColor: photo.localId === selectedId ? Gallery.segmentSelection : Gallery.paper, borderRadius: 2 }}>
      <View style={{ width: '100%', aspectRatio: 1, backgroundColor: Gallery.fill }}>{photo.path && <Image source={{ uri: captureFileUri(photo.path) }} style={{ width: '100%', height: '100%' }} contentFit="contain" />}</View>
      <Text style={{ color: Gallery.ink, fontSize: 15, lineHeight: 22, fontWeight: '500' }}>{photo.caption || kind}{photo.localId === selectedId ? ' ✓' : ''}</Text>
      <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>{visit ? formatVisitDate(visit.visitedOn) : 'Not linked to a visit'} · {kind}</Text>
    </Pressable>;
  })}</ScrollView>;
}
